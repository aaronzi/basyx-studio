import type { AppManifest } from '@basyx/studio-sdk/protocol'
import type { TrustStore } from '~~/server/lib/apps/trust'
import type { StudioConfig } from '~~/server/lib/config'
import type { DatabaseHandle } from '~~/server/lib/database/client'
import type { Actor, StudioDeps } from '~~/server/lib/deps'
import { randomBytes } from 'node:crypto'
import { isLoopbackOrigin, needsRemoteCodeGrant, originCovers } from '@basyx/studio-app-kit/manifest'
import { signPackage } from '@basyx/studio-app-kit/signature'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { authorizeAppCall } from '~~/server/lib/apps/calls'
import { contributionsFor } from '~~/server/lib/apps/contributions'
import { appContentSecurityPolicy } from '~~/server/lib/apps/csp'
import { appBaseUrl, appFileUrl, appFrameOrigin, appsHostOf, coversStudioOrigin, hasInstallationOrigins } from '~~/server/lib/apps/origins'
import { readAppPackage } from '~~/server/lib/apps/package'
import { checkSandbox } from '~~/server/lib/apps/sandbox'
import { inspectAppPackage, installApp, listActiveInstallations, toAppInstallation } from '~~/server/lib/apps/store'
import { installationTrust, parseTrustStore } from '~~/server/lib/apps/trust'
import { ConfigurationError, loadStudioConfig } from '~~/server/lib/config'
import { SecretCipher } from '~~/server/lib/crypto/cipher'
import { openDatabase } from '~~/server/lib/database/client'
import { applyMigrations, loadMigrationsFromDirectory } from '~~/server/lib/database/migrate'
import { StudioProblem } from '~~/server/lib/problem'
import { keyPair, manifestOf, zipApp } from './support'

// One origin per installation, declared third-party origins and full-page
// modules (ADR 0045).

const id = 'app-0123456789abcdef'
const shared = 'https://apps.example.org/app/'
const pattern = 'https://{installation}.apps.example.org/app/'

const hosted = {
  STUDIO_PUBLIC_URL: 'https://studio.example.org',
  STUDIO_DATA_KEY: randomBytes(32).toString('base64url'),
  STUDIO_OIDC_ISSUER: 'https://idp.example.org/realms/x',
  STUDIO_OIDC_CLIENT_ID: 'studio',
}

function directives (policy: string) {
  return Object.fromEntries(policy.split('; ').map(directive => {
    const [name, ...values] = directive.split(' ')
    return [name, values.join(' ')]
  }))
}

function findings (manifest: AppManifest): unknown[] {
  try {
    readAppPackage(zipApp(manifest), 'hosted')
    return []
  } catch (error) {
    if (error instanceof StudioProblem) {
      return error.violations ?? []
    }
    throw error
  }
}

function problemOf (action: () => unknown): StudioProblem {
  try {
    action()
  } catch (error) {
    if (error instanceof StudioProblem) {
      return error
    }
    throw error
  }
  throw new Error('Expected a problem.')
}

describe('STUDIO_APPS_URL', () => {
  it('keeps one shared apps origin without {installation}', () => {
    const config = loadStudioConfig({ ...hosted, STUDIO_APPS_URL: 'https://apps.example.org' }, 'hosted')
    expect(config.apps.baseUrl).toBe(shared)
    expect(hasInstallationOrigins(config.apps.baseUrl!)).toBe(false)
  })

  it('gives every installation its own origin with {installation} as the first label', () => {
    const config = loadStudioConfig({ ...hosted, STUDIO_APPS_URL: 'https://{installation}.apps.example.org' }, 'hosted', '/studio/')
    expect(config.apps.baseUrl).toBe('https://{installation}.apps.example.org/studio/app/')
    expect(appFileUrl(config.apps.baseUrl!, id, 'ui/index.html')).toBe(`https://${id}.apps.example.org/studio/app/${id}/ui/index.html`)
    const local = loadStudioConfig({ ...hosted, STUDIO_PUBLIC_URL: 'http://localhost:3000', STUDIO_APPS_URL: 'http://{installation}.apps.localhost:3000' }, 'hosted')
    expect(appFrameOrigin(local.apps.baseUrl!, id)).toBe(`http://${id}.apps.localhost:3000`)
  })

  it('refuses {installation} anywhere but the first label, twice, or matching Studio\'s host', () => {
    for (const value of ['https://apps.{installation}.example.org', 'https://{installation}-apps.example.org', 'https://{installation}.{installation}.example.org', 'https://apps.example.org/{installation}']) {
      expect(() => loadStudioConfig({ ...hosted, STUDIO_APPS_URL: value }, 'hosted'), value).toThrow(ConfigurationError)
    }
    expect(() => loadStudioConfig({ ...hosted, STUDIO_PUBLIC_URL: `https://${id}.example.org`, STUDIO_APPS_URL: 'https://{installation}.example.org' }, 'hosted')).toThrow('must not match')
  })
})

describe('apps origins', () => {
  it('builds file URLs and frame origins for the shared origin, the pattern and desktop', () => {
    expect(appBaseUrl(shared, id)).toBe(`https://apps.example.org/app/${id}/`)
    expect(appFrameOrigin(shared, id)).toBeNull()
    expect(appBaseUrl(pattern, id)).toBe(`https://${id}.apps.example.org/app/${id}/`)
    expect(appFrameOrigin(pattern, id)).toBe(`https://${id}.apps.example.org`)
    expect(appBaseUrl('studio-app://', id)).toBe(`studio-app://${id}/`)
    expect(appFrameOrigin('studio-app://', id)).toBe(`studio-app://${id}`)
    expect(hasInstallationOrigins('studio-app://')).toBe(true)
  })

  it('tells the apps hosts apart from Studio\'s own', () => {
    expect(appsHostOf(shared, 'apps.example.org')).toEqual({ installationId: null })
    expect(appsHostOf(shared, 'studio.example.org')).toBeNull()
    expect(appsHostOf(pattern, `${id}.apps.example.org`)).toEqual({ installationId: id })
    expect(appsHostOf(pattern, `${id.toUpperCase().replace('APP', 'app')}.Apps.Example.org`)).toEqual({ installationId: id })
    for (const host of ['apps.example.org', 'studio.example.org', `x.${id}.apps.example.org`, 'app-0123.apps.example.org', `${id}.apps.example.org.evil.test`, `${id}xapps.example.org`]) {
      expect(appsHostOf(pattern, host), host).toBeNull()
    }
    expect(appsHostOf('http://{installation}.apps.localhost:3000/app/', `${id}.apps.localhost:3000`)).toEqual({ installationId: id })
    expect(appsHostOf('http://{installation}.apps.localhost:3000/app/', `${id}.apps.localhost:3001`)).toBeNull()
  })

  it('finds declared origins that would reach Studio or its apps', () => {
    const studio = ['https://studio.example.org']
    expect(coversStudioOrigin('https://studio.example.org', studio, pattern)).toBe(true)
    expect(coversStudioOrigin('https://*.example.org', studio, pattern)).toBe(true)
    expect(coversStudioOrigin('https://*.apps.example.org', [], pattern)).toBe(true)
    expect(coversStudioOrigin(`https://${id}.apps.example.org`, [], pattern)).toBe(true)
    expect(coversStudioOrigin('https://apps.example.org', [], shared)).toBe(true)
    expect(coversStudioOrigin('https://*.example.org', [], shared)).toBe(true)
    expect(coversStudioOrigin('https://viewer.example.com', studio, pattern)).toBe(false)
    expect(coversStudioOrigin('https://studio.example.org:8443', studio, pattern)).toBe(false)
    expect(coversStudioOrigin('http://localhost:3000', ['http://localhost:3000'], 'studio-app://')).toBe(true)
    expect(coversStudioOrigin('http://localhost:8080', ['http://localhost:3000'], 'studio-app://')).toBe(false)
  })
})

describe('the policy of app files', () => {
  const base = `https://${id}.apps.example.org/app/${id}/`

  it('keeps the document opaque with a shared origin, and its own origin otherwise', () => {
    expect(directives(appContentSecurityPolicy(base, ['https://studio.example.org'])).sandbox).toBe('allow-scripts')
    expect(directives(appContentSecurityPolicy(base, ['https://studio.example.org'], {}, { sameOrigin: true })).sandbox).toBe('allow-scripts allow-same-origin')
  })

  it('appends declared origins to their directive only', () => {
    const policy = directives(appContentSecurityPolicy(base, ['https://studio.example.org'], {
      frameOrigins: ['https://viewer.example.com', 'https://*.dashboards.example.com'],
      connectOrigins: ['https://api.weather.example'],
      imageOrigins: ['https://tiles.example.com'],
      mediaOrigins: ['https://media.example.com'],
    }))
    expect(policy).toMatchObject({
      'frame-src': 'https://viewer.example.com https://*.dashboards.example.com',
      'connect-src': `${base} https://api.weather.example`,
      'img-src': `${base} data: blob: https://tiles.example.com`,
      'media-src': `${base} blob: https://media.example.com`,
      'script-src': base,
      'worker-src': '\'none\'',
      'frame-ancestors': 'https://studio.example.org',
    })
    expect(directives(appContentSecurityPolicy(base, []))['frame-src']).toBe('\'none\'')
  })

  it('leaves out what the caller excludes, and never lets workers load the app\'s files', () => {
    const policy = directives(appContentSecurityPolicy(base, [], { frameOrigins: ['https://*.example.org'], connectOrigins: ['https://*.example.org', 'https://api.example.com'], workers: true }, {
      excludeOrigin: origin => origin === 'https://*.example.org',
    }))
    expect(policy['frame-src']).toBe('\'none\'')
    expect(policy['connect-src']).toBe(`${base} https://api.example.com`)
    expect(policy['worker-src']).toBe('blob:')
  })
})

describe('origins in the manifest', () => {
  const app = (sandbox: AppManifest['sandbox'], studioApi = '^0.1.3') => manifestOf({ studioApi, sandbox })

  it('accepts https origins with one leading wildcard label, and http for loopback', () => {
    expect(findings(app({
      frameOrigins: ['https://viewer.example.com', 'https://*.example.com:8443'],
      connectOrigins: ['http://localhost:8080', 'http://api.localhost', 'http://127.0.0.1:9000', 'http://[::1]:3000'],
      imageOrigins: ['https://tiles.example.com'],
      mediaOrigins: [],
    }))).toEqual([])
  })

  it('refuses paths, upper case, plain http, wildcards on a single label and ports that do not exist', () => {
    for (const origin of ['https://example.com/', 'https://example.com/path', 'https://Example.com', 'http://example.com', 'https://*.com', 'https://*.*.example.com', 'https://a.*.example.com', 'https://localhost', 'ftp://example.com', '*']) {
      expect(findings(app({ frameOrigins: [origin] })), origin).toEqual([expect.objectContaining({ path: 'studio-app.json#sandbox.frameOrigins.0' })])
    }
    expect(findings(app({ connectOrigins: ['https://example.com:70000'] }))).toEqual([{ path: 'studio-app.json#sandbox.connectOrigins[0]', message: 'has the port 70000, which does not exist' }])
    expect(findings(app({ imageOrigins: Array.from({ length: 17 }, (_, index) => `https://h${index}.example.com`) }))).toHaveLength(1)
  })

  it('needs Studio app API 0.1.3 for origins and the module layout', () => {
    expect(findings(app({ frameOrigins: ['https://viewer.example.com'] }, '^0.1.0'))).toEqual([{
      path: 'studio-app.json#studioApi',
      message: 'allows Studio app API 0.1.0, but sandbox.frameOrigins needs 0.1.3; declare ^0.1.3',
    }])
    const page = manifestOf({ studioApi: '>=0.1.2 <0.2.0', contributes: { modules: [{ id: 'm', title: { en: 'M' }, entry: 'ui/index.html', route: 'm', context: 'global', layout: 'fullPage' }] } })
    expect(findings(page)).toEqual([expect.objectContaining({ message: expect.stringContaining('contributes.modules[0].layout needs 0.1.3') })])
    expect(findings({ ...page, studioApi: '^0.1.3' })).toEqual([])
    expect(findings(manifestOf({ contributes: { modules: [{ id: 'm', title: { en: 'M' }, entry: 'ui/index.html', route: 'm', context: 'global', layout: 'wide' as never }] } }))).toEqual([
      { path: 'studio-app.json#contributes.modules.0.layout', message: 'must be one of "standard", "fullPage"' },
    ])
  })

  it('matches origins as a CSP host source does', () => {
    expect(originCovers('https://*.example.org', 'https://a.b.example.org')).toBe(true)
    expect(originCovers('https://*.example.org', 'https://example.org')).toBe(false)
    expect(originCovers('https://example.org', 'https://example.org:443')).toBe(true)
    expect(originCovers('https://example.org', 'http://example.org')).toBe(false)
    expect(originCovers('https://example.org:8443', 'https://example.org')).toBe(false)
    expect(isLoopbackOrigin('http://studio.localhost:3000')).toBe(true)
    expect(isLoopbackOrigin('https://localhost')).toBe(false)
  })

  it('tells when code from outside the package could run', () => {
    expect(needsRemoteCodeGrant(app({ connectOrigins: ['https://api.example.com'] }))).toBe(false)
    expect(needsRemoteCodeGrant(app({ frameOrigins: ['https://viewer.example.com'], webAssembly: true }))).toBe(false)
    expect(needsRemoteCodeGrant(app({ connectOrigins: ['https://cdn.example.com'], webAssembly: true }))).toBe(true)
    expect(needsRemoteCodeGrant(app({ connectOrigins: ['https://cdn.example.com'], workers: true }))).toBe(true)
  })
})

describe('the deployment\'s sandbox checks', () => {
  const config = (deploymentMode: 'hosted' | 'desktop' = 'hosted') => ({
    deploymentMode,
    publicUrl: deploymentMode === 'desktop' ? 'http://127.0.0.1:3000' : 'https://studio.example.org',
    apps: { baseUrl: deploymentMode === 'desktop' ? 'studio-app://' : pattern },
  }) as StudioConfig
  const grant = parseTrustStore(JSON.stringify({ publishers: [{ name: 'Example GmbH', keys: [keyPair().pem], appIds: ['org.example.*'], remoteCode: true }] }), '/').publishers[0]!
  const manifest = (sandbox: AppManifest['sandbox']) => manifestOf({ studioApi: '^0.1.3', sandbox })

  it('refuses origins that cover Studio or its apps', () => {
    const problem = problemOf(() => checkSandbox(config(), manifest({ frameOrigins: ['https://viewer.example.com', 'https://*.example.org'] }), { publisher: null, developerMode: true }))
    expect(problem.code).toBe('app_package_rejected')
    expect(problem.violations).toEqual([{ path: 'studio-app.json#sandbox.frameOrigins[1]', message: 'covers an origin of this Studio or of its apps, which apps may not reach' }])
    expect(problemOf(() => checkSandbox(config('desktop'), manifest({ connectOrigins: ['http://localhost:3000'] }), { publisher: null, developerMode: true })).code).toBe('app_package_rejected')
  })

  it('accepts loopback origins in developer mode and on desktop only', () => {
    const local = manifest({ frameOrigins: ['http://localhost:8080'] })
    expect(problemOf(() => checkSandbox(config(), local, { publisher: grant, developerMode: false })).violations).toEqual([
      { path: 'studio-app.json#sandbox.frameOrigins[0]', message: 'is a loopback origin, which hosted Studio accepts only in developer mode' },
    ])
    expect(() => checkSandbox(config(), local, { publisher: null, developerMode: true })).not.toThrow()
    expect(() => checkSandbox(config('desktop'), local, { publisher: null, developerMode: false })).not.toThrow()
  })

  it('needs the publisher\'s remoteCode grant for connect origins with WebAssembly or workers', () => {
    const loader = manifest({ connectOrigins: ['https://cdn.example.com'], webAssembly: true })
    expect(problemOf(() => checkSandbox(config(), loader, { publisher: null, developerMode: true })).code).toBe('app_sandbox_not_granted')
    expect(problemOf(() => checkSandbox(config(), loader, { publisher: { ...grant, remoteCode: false }, developerMode: false })).code).toBe('app_sandbox_not_granted')
    expect(() => checkSandbox(config(), loader, { publisher: grant, developerMode: false })).not.toThrow()
  })

  it('reads remoteCode from the trust store, false by default', () => {
    const store = parseTrustStore(JSON.stringify({ publishers: [{ name: 'A', keys: [keyPair().pem], appIds: ['*'] }] }), '/')
    expect(store.publishers[0]!.remoteCode).toBe(false)
    expect(() => parseTrustStore(JSON.stringify({ publishers: [{ name: 'A', keys: [keyPair().pem], appIds: ['*'], remoteCode: 'yes' }] }), '/')).toThrow('remoteCode')
  })
})

describe('installing and updating apps with declared origins', () => {
  const migrationsDirectory = new URL('../../server/database/migrations', import.meta.url).pathname
  const admin: Actor = { subject: 'studio-admin', name: 'Admin', roles: ['studio-admin'], isAdmin: true, sessionId: 's1' }
  const example = keyPair()
  const storeWith = (remoteCode: boolean): TrustStore => parseTrustStore(JSON.stringify({ publishers: [{ name: 'Example GmbH', keys: [example.pem], appIds: ['org.example.*'], remoteCode }] }), '/')
  const granting = storeWith(true)
  const configWith = (trustStore: TrustStore): StudioConfig => ({
    deploymentMode: 'hosted',
    publicUrl: 'http://localhost:3000',
    adminRole: 'studio-admin',
    deployment: { appInstalls: true },
    apps: { baseUrl: 'http://{installation}.apps.localhost:3000/app/', allowUnsigned: true, trustStore, packages: [], denoPath: null, capabilityUrl: 'http://127.0.0.1:3000', workDir: '/tmp' },
  }) as StudioConfig
  const packageOf = (manifest: Partial<AppManifest>) => zipApp(manifestOf({ studioApi: '^0.1.3', ...manifest }))
  let handle: DatabaseHandle
  let deps: StudioDeps

  beforeAll(async () => {
    handle = await openDatabase({ kind: 'memory' })
    await applyMigrations(handle.db, await loadMigrationsFromDirectory(migrationsDirectory))
    deps = { config: configWith(granting), db: handle.db, cipher: new SecretCipher(randomBytes(32)) }
  })

  afterAll(async () => {
    await handle.close()
  })

  it('shows the origins for consent and lists added and removed ones on an update', async () => {
    const first = packageOf({ id: 'org.example.embeds', version: '1.0.0', sandbox: { frameOrigins: ['https://viewer.example.com'], imageOrigins: ['https://tiles.example.com'] } })
    const { record } = await installApp(deps, admin, first, signPackage(first, example.privateKey), 'o1')
    expect(toAppInstallation(record, granting).sandbox).toMatchObject({ frameOrigins: ['https://viewer.example.com'], imageOrigins: ['https://tiles.example.com'], connectOrigins: [] })

    const next = packageOf({ id: 'org.example.embeds', version: '1.1.0', sandbox: { frameOrigins: ['https://viewer.example.com', 'https://*.dashboards.example.com'], connectOrigins: ['https://api.weather.example'] } })
    const inspection = await inspectAppPackage(deps, next, signPackage(next, example.privateKey))
    expect(inspection.update).toMatchObject({
      originsAdded: [{ kind: 'frameOrigins', origin: 'https://*.dashboards.example.com' }, { kind: 'connectOrigins', origin: 'https://api.weather.example' }],
      originsRemoved: [{ kind: 'imageOrigins', origin: 'https://tiles.example.com' }],
    })
  })

  it('gives each installation its frame origin and modules their layout', async () => {
    const bytes = packageOf({ id: 'org.example.page', version: '1.0.0', contributes: { modules: [{ id: 'page', title: { en: 'Page' }, entry: 'ui/index.html', route: 'page', context: 'global', layout: 'fullPage' }] } })
    const { record } = await installApp(deps, admin, bytes, null, 'o2')
    const [module] = contributionsFor([record], deps.config.apps.baseUrl!, []).modules
    expect(module).toMatchObject({ layout: 'fullPage', frameOrigin: `http://${record.id}.apps.localhost:3000`, entryUrl: `http://${record.id}.apps.localhost:3000/app/${record.id}/ui/index.html` })
    expect(contributionsFor([record], 'http://apps.localhost:3000/app/', []).modules[0]).toMatchObject({ frameOrigin: null })
  })

  it('installs code from connect origins only with the grant, and revokes it when the grant is gone', async () => {
    const loader = (version: string) => packageOf({ id: 'org.example.loader', version, sandbox: { connectOrigins: ['https://cdn.example.com'], workers: true } })
    const unsigned = loader('1.0.0')
    await expect(installApp(deps, admin, unsigned, null, 'o3')).rejects.toMatchObject({ code: 'app_sandbox_not_granted' })
    const signed = loader('1.0.0')
    const { record } = await installApp(deps, admin, signed, signPackage(signed, example.privateKey), 'o4')
    expect(toAppInstallation(record, granting)).toMatchObject({ remoteCode: true, revoked: null })

    // The next start without the grant.
    const withdrawn = storeWith(false)
    expect(installationTrust(record, withdrawn).revoked).toBe('remoteCodeNotGranted')
    expect((await listActiveInstallations({ ...deps, config: configWith(withdrawn) })).map(entry => entry.appId)).not.toContain('org.example.loader')
    expect(() => authorizeAppCall(record, 'studio.aas.getShell', 'host', withdrawn)).toThrow('no longer granted remoteCode')
  })
})
