import type { AppManifest } from '@basyx/studio-sdk/protocol'
import type { TrustStore } from '~~/server/lib/apps/trust'
import type { StudioConfig } from '~~/server/lib/config'
import type { DatabaseHandle } from '~~/server/lib/database/client'
import type { Actor, StudioDeps } from '~~/server/lib/deps'
import { randomBytes } from 'node:crypto'
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parsePublicKey, signPackage } from '@basyx/studio-app-kit/signature'
import { and, eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { appBlobs, appFiles, appInstallations, auditEvents } from '~~/server/database/schema'
import { authorizeAppCall, requireInstalledRevision } from '~~/server/lib/apps/calls'
import { contributionsFor } from '~~/server/lib/apps/contributions'
import { reconcileManagedPackages } from '~~/server/lib/apps/packages'
import { getInstallation, inspectAppPackage, installApp, installBundledApp, listActiveInstallations, listInstallations, lockAppId, readAppFile, toAppInstallation, uninstallApp } from '~~/server/lib/apps/store'
import { parseTrustStore } from '~~/server/lib/apps/trust'
import { SecretCipher } from '~~/server/lib/crypto/cipher'
import { openDatabase } from '~~/server/lib/database/client'
import { applyMigrations, loadMigrationsFromDirectory } from '~~/server/lib/database/migrate'
import { StudioProblem } from '~~/server/lib/problem'
import { testenvAvailable, testenvDatabaseUrl } from '../support/testenv'
import { keyPair, manifestOf, zipApp } from './support'

const migrationsDirectory = new URL('../../server/database/migrations', import.meta.url).pathname
const admin: Actor = { subject: 'studio-admin', name: 'Admin', roles: ['studio-admin'], isAdmin: true, sessionId: 's1' }

const example = keyPair()
const exampleRotated = keyPair()
const other = keyPair()

function storeOf (...publishers: Array<{ name: string, pems: string[], appIds: string[], permissions?: string[] }>): TrustStore {
  return parseTrustStore(JSON.stringify({ publishers: publishers.map(entry => ({ name: entry.name, keys: entry.pems, appIds: entry.appIds, permissions: entry.permissions ?? [] })) }), '/')
}

const trusted = storeOf(
  { name: 'Example GmbH', pems: [example.pem, exampleRotated.pem], appIds: ['org.example.*'], permissions: ['studio.timeseries.read'] },
  { name: 'Other AG', pems: [other.pem], appIds: ['org.example.shared', 'org.other.*'] },
)

function configWith (apps: Partial<StudioConfig['apps']>, appInstalls = true): StudioConfig {
  return {
    deploymentMode: 'hosted',
    publicUrl: 'http://localhost:3000',
    adminRole: 'studio-admin',
    deployment: { appInstalls },
    apps: { baseUrl: 'http://apps.localhost:3000/app/', allowUnsigned: false, trustStore: trusted, packages: [], denoPath: null, capabilityUrl: 'http://127.0.0.1:3000', workDir: '/tmp', ...apps },
  } as StudioConfig
}

function packageOf (manifest: Partial<AppManifest>, html = `<p>${manifest.id} ${manifest.version}</p>`): Uint8Array {
  return zipApp(manifestOf(manifest), { 'ui/index.html': html })
}

async function failure (promise: Promise<unknown>): Promise<StudioProblem> {
  try {
    await promise
  } catch (error) {
    if (error instanceof StudioProblem) {
      return error
    }
    throw error
  }
  throw new Error('Expected a problem.')
}

async function html (deps: StudioDeps, id: string): Promise<string | null> {
  const file = await readAppFile(deps, id, 'ui/index.html')
  return file ? new TextDecoder().decode(file.content) : null
}

describe('signed installs and in-place updates', () => {
  let handle: DatabaseHandle
  let deps: StudioDeps

  beforeAll(async () => {
    handle = await openDatabase({ kind: 'memory' })
    await applyMigrations(handle.db, await loadMigrationsFromDirectory(migrationsDirectory))
    deps = { config: configWith({}), db: handle.db, cipher: new SecretCipher(randomBytes(32)) }
  })

  afterAll(async () => {
    await handle.close()
  })

  it('installs a signed package without developer mode and records its publisher', async () => {
    const bytes = packageOf({ id: 'org.example.app', version: '1.0.0' })
    expect((await failure(installApp(deps, admin, bytes, null, 'r1'))).code).toBe('app_unsigned_disabled')

    const signature = signPackage(bytes, example.privateKey)
    const inspection = await inspectAppPackage(deps, bytes, signature)
    expect(inspection).toMatchObject({ appId: 'org.example.app', trust: 'signed', verifiedPublisher: 'Example GmbH', keyFingerprint: parsePublicKey(example.pem).fingerprint, update: null })
    expect(await listInstallations(deps)).toEqual([])

    const { record, previous } = await installApp(deps, admin, bytes, signature, 'r2')
    expect(previous).toBeNull()
    expect(toAppInstallation(record, trusted)).toMatchObject({ trust: 'signed', verifiedPublisher: 'Example GmbH', publisher: 'Example', revoked: null, managed: false })
  })

  it('refuses a bad signature also when unsigned packages are allowed', async () => {
    const developer = { ...deps, config: configWith({ allowUnsigned: true }) }
    const bytes = packageOf({ id: 'org.example.bad', version: '1.0.0' })
    expect((await failure(installApp(developer, admin, bytes, signPackage(packageOf({ id: 'org.example.bad', version: '1.0.1' }), example.privateKey), 'r3'))).code).toBe('app_signature_invalid')
    expect((await failure(installApp(developer, admin, bytes, signPackage(bytes, keyPair().privateKey), 'r4'))).code).toBe('app_signature_invalid')
    expect((await failure(installApp(developer, admin, packageOf({ id: 'com.foreign.app', version: '1.0.0' }), signPackage(packageOf({ id: 'com.foreign.app', version: '1.0.0' }), example.privateKey), 'r5'))).code).toBe('app_signer_not_allowed')
    expect((await listInstallations(deps)).map(record => record.appId)).toEqual(['org.example.app'])
  })

  it('updates in place with a higher version of the same publisher, keeping the installation ID', async () => {
    const [installed] = await listInstallations(deps)
    const bytes = packageOf({ id: 'org.example.app', version: '1.1.0', permissions: ['studio.aas.read', 'studio.ui.notifications'], sandbox: { workers: true } })
    // Signed with the publisher's other key, as after a key rotation.
    const signature = signPackage(bytes, exampleRotated.privateKey)
    const inspection = await inspectAppPackage(deps, bytes, signature)
    expect(inspection.update).toEqual({
      installationId: installed!.id,
      version: '1.0.0',
      trust: 'signed',
      verifiedPublisher: 'Example GmbH',
      permissionsAdded: ['studio.ui.notifications'],
      permissionsRemoved: [],
      sandboxAdded: ['workers'],
      originsAdded: [],
      originsRemoved: [],
      backendAdded: false,
    })

    const { record, previous } = await installApp(deps, admin, bytes, signature, 'r6')
    expect(record.id).toBe(installed!.id)
    expect(previous?.version).toBe('1.0.0')
    expect(record).toMatchObject({ version: '1.1.0', keyFingerprint: parsePublicKey(exampleRotated.pem).fingerprint })
    expect(await html(deps, record.id)).toBe('<p>org.example.app 1.1.0</p>')
    expect(await handle.db.select().from(appFiles).where(eq(appFiles.installationId, record.id))).toHaveLength(1)
    // The blob of version 1.0.0 is gone.
    const used = new Set((await handle.db.select({ digest: appFiles.digest }).from(appFiles)).map(row => row.digest))
    expect((await handle.db.select({ digest: appBlobs.digest }).from(appBlobs)).every(row => used.has(row.digest))).toBe(true)
    const [audit] = await handle.db.select().from(auditEvents).where(and(eq(auditEvents.appInstallationId, record.id), eq(auditEvents.action, 'app.update')))
    expect(audit?.details).toMatchObject({ version: '1.1.0', previousVersion: '1.0.0', trust: 'signed', publisher: 'Example GmbH' })
  })

  it('refuses calls from frames and backends of the version before an update', async () => {
    const record = (await listInstallations(deps)).find(entry => entry.appId === 'org.example.app')!
    const [update] = await handle.db.select().from(auditEvents).where(and(eq(auditEvents.appInstallationId, record.id), eq(auditEvents.action, 'app.update')))
    const previous = (update!.details as { previousDigest: string }).previousDigest
    expect(() => requireInstalledRevision(record, previous)).toThrow(expect.objectContaining({ code: 'app_outdated' }))
    expect(() => requireInstalledRevision(record, record.digest)).not.toThrow()
    // Frames get the digest with their contribution, and send it with every call.
    const [view] = contributionsFor([record], 'http://apps.localhost:3000/app/', ['urn:example:semantic']).submodelViews
    expect(view?.digest).toBe(record.digest)
  })

  it('refuses the same version, downgrades, other publishers and unsigned updates of signed apps', async () => {
    const developer = { ...deps, config: configWith({ allowUnsigned: true }) }
    const sameVersion = packageOf({ id: 'org.example.app', version: '1.1.0' }, '<p>rebuilt</p>')
    expect((await failure(installApp(deps, admin, sameVersion, signPackage(sameVersion, example.privateKey), 'r7'))).code).toBe('app_already_installed')
    const downgrade = packageOf({ id: 'org.example.app', version: '1.0.5' })
    expect((await failure(installApp(deps, admin, downgrade, signPackage(downgrade, example.privateKey), 'r8'))).detail).toContain('needs a higher version')

    // Other AG may sign org.example.shared, but not update Example's app.
    const shared = packageOf({ id: 'org.example.shared', version: '1.0.0' })
    await installApp(deps, admin, shared, signPackage(shared, example.privateKey), 'r9')
    const takeover = packageOf({ id: 'org.example.shared', version: '2.0.0' })
    expect((await failure(installApp(deps, admin, takeover, signPackage(takeover, other.privateKey), 'r10'))).code).toBe('app_signer_not_allowed')

    const unsigned = packageOf({ id: 'org.example.app', version: '2.0.0' })
    expect((await failure(installApp(developer, admin, unsigned, null, 'r11'))).code).toBe('app_signer_not_allowed')
  })

  it('updates unsigned installs in developer mode, and signs them on a signed update', async () => {
    const developer = { ...deps, config: configWith({ allowUnsigned: true }) }
    const { record: first } = await installApp(developer, admin, packageOf({ id: 'org.example.dev', version: '0.1.0' }), null, 'r12')
    const { record: second } = await installApp(developer, admin, packageOf({ id: 'org.example.dev', version: '0.2.0' }), null, 'r13')
    expect(second.id).toBe(first.id)
    expect(second.trust).toBe('unsigned')
    expect((await failure(installApp(developer, admin, packageOf({ id: 'org.example.dev', version: '0.1.5' }), null, 'r14'))).code).toBe('app_already_installed')
    // Unsigned updates need developer mode.
    expect((await failure(installApp(deps, admin, packageOf({ id: 'org.example.dev', version: '0.3.0' }), null, 'r15'))).code).toBe('app_unsigned_disabled')

    const signed = packageOf({ id: 'org.example.dev', version: '1.0.0' })
    const { record: third } = await installApp(deps, admin, signed, signPackage(signed, example.privateKey), 'r16')
    expect(third).toMatchObject({ id: first.id, trust: 'signed', publisher: 'Example GmbH' })
  })

  it('grants studio.timeseries.read to the apps of publishers the trust store grants it', async () => {
    const bytes = packageOf({ id: 'org.other.series', version: '1.0.0', permissions: ['studio.aas.read', 'studio.timeseries.read'] })
    const { record } = await installApp(deps, admin, bytes, signPackage(bytes, other.privateKey), 'r17')
    expect(toAppInstallation(record, trusted).grantedPermissions).toEqual([])
    expect(() => authorizeAppCall(record, 'studio.timeseries.read', 'host', trusted)).toThrow('reserved')

    const granted = packageOf({ id: 'org.example.series', version: '1.0.0', permissions: ['studio.aas.read', 'studio.timeseries.read'] })
    expect((await inspectAppPackage(deps, granted, signPackage(granted, example.privateKey))).grantedPermissions).toEqual(['studio.timeseries.read'])
    const { record: allowed } = await installApp(deps, admin, granted, signPackage(granted, example.privateKey), 'r18')
    expect(toAppInstallation(allowed, trusted).grantedPermissions).toEqual(['studio.timeseries.read'])
    expect(() => authorizeAppCall(allowed, 'studio.timeseries.read', 'host', trusted)).not.toThrow()
  })

  it('revokes apps whose key left the trust store, and restores them with a new signature', async () => {
    const record = (await listInstallations(deps)).find(entry => entry.appId === 'org.example.app')!
    // The next start without the rotated key.
    const rotatedOut = storeOf(
      { name: 'Example GmbH', pems: [example.pem], appIds: ['org.example.*'] },
      { name: 'Other AG', pems: [other.pem], appIds: ['org.example.shared', 'org.other.*'] },
    )
    const restarted = { ...deps, config: configWith({ trustStore: rotatedOut }) }
    expect(toAppInstallation(record, rotatedOut)).toMatchObject({ revoked: 'keyRemoved', verifiedPublisher: null })
    expect(await html(restarted, record.id)).toBeNull()
    expect((await listActiveInstallations(restarted)).map(entry => entry.appId)).not.toContain('org.example.app')
    expect(() => authorizeAppCall(record, 'studio.aas.getShell', 'host', rotatedOut)).toThrow(expect.objectContaining({ code: 'app_revoked' }))
    // Apps signed with the remaining key stay.
    expect((await listActiveInstallations(restarted)).map(entry => entry.appId)).toContain('org.example.shared')

    // The same version, signed again with a trusted key of the same publisher.
    const resigned = packageOf({ id: 'org.example.app', version: '1.1.0', permissions: ['studio.aas.read', 'studio.ui.notifications'], sandbox: { workers: true } })
    const { record: restored } = await installApp(restarted, admin, resigned, signPackage(resigned, example.privateKey), 'r19')
    expect(restored.id).toBe(record.id)
    expect(toAppInstallation(restored, rotatedOut).revoked).toBeNull()
    expect(await html(restarted, record.id)).toBe('<p>org.example.app 1.1.0</p>')

    const narrowed = storeOf({ name: 'Example GmbH', pems: [example.pem], appIds: ['org.example.dev'] })
    expect(toAppInstallation(restored, narrowed).revoked).toBe('appIdNotAllowed')
  })
})

describe('managed packages', () => {
  let handle: DatabaseHandle
  let deps: StudioDeps
  let directory: string

  beforeAll(async () => {
    handle = await openDatabase({ kind: 'memory' })
    await applyMigrations(handle.db, await loadMigrationsFromDirectory(migrationsDirectory))
    directory = mkdtempSync(join(tmpdir(), 'studio-managed-'))
    // A deployment that fixes its apps: managed packages still install.
    deps = { config: configWith({ packages: [directory] }, false), db: handle.db, cipher: new SecretCipher(randomBytes(32)) }
  })

  afterAll(async () => {
    rmSync(directory, { recursive: true, force: true })
    await handle.close()
  })

  function mount (name: string, bytes: Uint8Array, signature?: string) {
    writeFileSync(join(directory, name), bytes)
    rmSync(join(directory, `${name}.sig`), { force: true })
    if (signature !== undefined) {
      writeFileSync(join(directory, `${name}.sig`), signature)
    }
  }

  it('installs signed and unsigned packages by digest', async () => {
    const signed = packageOf({ id: 'org.example.managed', version: '2.0.0' })
    mount('managed.zip', signed, `${signPackage(signed, example.privateKey)}\n`)
    mount('plain.zip', packageOf({ id: 'org.plain.app', version: '1.0.0' }))
    expect(await reconcileManagedPackages(deps, deps.config.apps.packages)).toEqual({ installed: ['org.example.managed', 'org.plain.app'], updated: [], removed: [], failed: [] })
    expect(await reconcileManagedPackages(deps, deps.config.apps.packages)).toEqual({ installed: [], updated: [], removed: [], failed: [] })

    const items = (await listInstallations(deps)).map(record => toAppInstallation(record, trusted))
    expect(items.map(item => [item.appId, item.trust, item.verifiedPublisher, item.managed, item.installedBy])).toEqual([
      ['org.example.managed', 'signed', 'Example GmbH', true, 'deployment'],
      ['org.plain.app', 'managed', null, true, 'deployment'],
    ])
  })

  it('may go back to a lower version, keeping the installation ID', async () => {
    const before = (await listInstallations(deps)).find(record => record.appId === 'org.example.managed')!
    const lower = packageOf({ id: 'org.example.managed', version: '1.5.0' })
    mount('managed.zip', lower, signPackage(lower, example.privateKey))
    expect((await reconcileManagedPackages(deps, deps.config.apps.packages)).updated).toEqual(['org.example.managed'])
    expect(await getInstallation(deps, before.id)).toMatchObject({ version: '1.5.0', managed: true })
  })

  it('is not changed or removed through the UI', async () => {
    const developer = { ...deps, config: configWith({ allowUnsigned: true, packages: [directory] }) }
    const record = (await listInstallations(deps)).find(entry => entry.appId === 'org.plain.app')!
    expect((await failure(uninstallApp(developer, admin, record.id, 'u1'))).code).toBe('forbidden')
    expect((await failure(installApp(developer, admin, packageOf({ id: 'org.plain.app', version: '9.0.0' }), null, 'u2'))).detail).toContain('STUDIO_APP_PACKAGES')
  })

  it('takes over an app ID that Studio or an administrator installed', async () => {
    const developer = { ...deps, config: configWith({ allowUnsigned: true }) }
    const { record: uploaded } = await installApp(developer, admin, packageOf({ id: 'org.example.taken', version: '3.0.0' }), null, 'u3')
    await installBundledApp(deps, packageOf({ id: 'org.example.bundled', version: '1.0.0' }))
    const bundled = (await listInstallations(deps)).find(record => record.appId === 'org.example.bundled')!
    mount('taken.zip', packageOf({ id: 'org.example.taken', version: '1.0.0' }))
    mount('bundled.zip', packageOf({ id: 'org.example.bundled', version: '0.9.0' }))
    expect((await reconcileManagedPackages(deps, deps.config.apps.packages)).updated.toSorted()).toEqual(['org.example.bundled', 'org.example.taken'])
    expect(await getInstallation(deps, uploaded.id)).toMatchObject({ version: '1.0.0', managed: true, trust: 'managed' })
    expect(await getInstallation(deps, bundled.id)).toMatchObject({ version: '0.9.0', managed: true, bundled: false })
    // The bundled app no longer replaces the operator's package.
    expect(await installBundledApp(deps, packageOf({ id: 'org.example.bundled', version: '1.0.0' }))).toBe('skipped')
  })

  it('skips a package whose signature does not verify, and then removes nothing', async () => {
    const before = (await listInstallations(deps)).find(record => record.appId === 'org.example.managed')!
    const forged = packageOf({ id: 'org.example.managed', version: '5.0.0' })
    mount('managed.zip', forged, signPackage(forged, keyPair().privateKey))
    rmSync(join(directory, 'plain.zip'))
    const result = await reconcileManagedPackages(deps, deps.config.apps.packages)
    expect(result.failed).toEqual([expect.stringContaining('does not match the package with any key')])
    expect(result.removed).toEqual([])
    expect(await getInstallation(deps, before.id)).toMatchObject({ version: '1.5.0' })
    expect((await listInstallations(deps)).map(record => record.appId)).toContain('org.plain.app')
  })

  it('uninstalls managed apps that are no longer configured', async () => {
    rmSync(join(directory, 'managed.zip'))
    rmSync(join(directory, 'managed.zip.sig'))
    const result = await reconcileManagedPackages(deps, deps.config.apps.packages)
    expect(result.failed).toEqual([])
    expect(result.removed.toSorted()).toEqual(['org.example.managed', 'org.plain.app'])
    expect((await listInstallations(deps)).map(record => record.appId).toSorted()).toEqual(['org.example.bundled', 'org.example.taken'])
  })

  it('reports paths and signatures that cannot be read', async () => {
    expect((await reconcileManagedPackages(deps, [join(directory, 'missing.zip')])).failed).toEqual([`${join(directory, 'missing.zip')} cannot be read`])
    // cosign writes signatures readable by their owner only.
    const bytes = packageOf({ id: 'org.example.private', version: '1.0.0' })
    mount('private.zip', bytes, signPackage(bytes, example.privateKey))
    chmodSync(join(directory, 'private.zip.sig'), 0o000)
    expect((await reconcileManagedPackages(deps, [join(directory, 'private.zip')])).failed).toEqual([`${join(directory, 'private.zip.sig')} cannot be read`])
  })
})

const engines = [
  { name: 'PGlite (in memory)', open: () => openDatabase({ kind: 'memory' }), enabled: true },
  { name: 'PostgreSQL 18 (test environment)', open: () => openDatabase({ kind: 'postgres', url: testenvDatabaseUrl }), enabled: testenvAvailable },
]

describe.each(engines)('concurrent changes on $name', ({ open, enabled }) => {
  it.runIf(enabled)('waits for another change of the same app ID before checking the installed version', async () => {
    const handle = await open()
    const deps: StudioDeps = { config: configWith({}), db: handle.db, cipher: new SecretCipher(randomBytes(32)) }
    // The test environment's database outlives the test.
    const appId = `org.example.concurrent-${randomBytes(4).toString('hex')}`
    const signed = (version: string) => {
      const bytes = packageOf({ id: appId, version })
      return [bytes, signPackage(bytes, example.privateKey)] as const
    }
    try {
      await applyMigrations(handle.db, await loadMigrationsFromDirectory(migrationsDirectory))
      const { record } = await installApp(deps, admin, ...signed('1.0.0'), 'c1')

      // Another update holds the app ID, e.g. on another replica.
      let release!: () => void
      const held = new Promise<void>(resolve => (release = resolve))
      let locked!: () => void
      const holding = new Promise<void>(resolve => (locked = resolve))
      const other = handle.db.transaction(async tx => {
        await lockAppId(tx, appId)
        locked()
        await held
        await tx.update(appInstallations).set({ version: '3.0.0', digest: 'sha256:other' }).where(eq(appInstallations.id, record.id))
      })
      await holding
      let finished = false
      const update = installApp(deps, admin, ...signed('2.0.0'), 'c2').finally(() => (finished = true))
      await new Promise(resolve => setTimeout(resolve, 300))
      expect(finished).toBe(false)
      release()
      await other
      // It saw 1.0.0 before; now 3.0.0 is installed, so it must not overwrite it.
      expect((await failure(update)).code).toBe('app_already_installed')
      expect((await getInstallation(deps, record.id)).version).toBe('3.0.0')
      await uninstallApp(deps, admin, record.id, 'c3')
    } finally {
      await handle.close()
    }
  })
})
