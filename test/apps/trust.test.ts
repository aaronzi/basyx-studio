import type { TrustStore } from '~~/server/lib/apps/trust'
import type { StudioProblem } from '~~/server/lib/problem'
import { randomBytes } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parsePublicKey, signPackage } from '@basyx/studio-app-kit/signature'
import { describe, expect, it } from 'vitest'
import { installationTrust, matchesAppId, parseTrustStore, TrustStoreError, verifyPackageSignature } from '~~/server/lib/apps/trust'
import { ConfigurationError, loadStudioConfig } from '~~/server/lib/config'
import { fixturesDirectory, keyPair, manifestOf, zipApp } from './support'

const cosign = join(fixturesDirectory, 'cosign')
const signedZip = new Uint8Array(readFileSync(join(cosign, 'org.example.signed-1.0.0.zip')))
const cosignPublicKey = readFileSync(join(cosign, 'cosign.pub'), 'utf8')

function storeOf (...publishers: Array<{ name: string, pems: string[], appIds: string[], permissions?: string[] }>): TrustStore {
  return parseTrustStore(JSON.stringify({ publishers: publishers.map(entry => ({ name: entry.name, keys: entry.pems, appIds: entry.appIds, permissions: entry.permissions ?? [] })) }), '/')
}

function problemOf (action: () => unknown): string {
  try {
    action()
  } catch (error) {
    return (error as StudioProblem).code
  }
  return 'accepted'
}

describe('the trust store', () => {
  it('reads keys inline and from files next to it, with patterns and grants', () => {
    const { pem } = keyPair()
    const store = parseTrustStore(`
version: 1
publishers:
  - name: Example GmbH
    keys: [keys/cosign.pub]
    appIds: [org.example.*]
    permissions: [studio.timeseries.read]
  - name: Other
    keys:
      - |
${pem.trim().split('\n').map(line => `        ${line}`).join('\n')}
    appIds: [org.other.app]
`, '/trust', path => {
      expect(path).toBe('/trust/keys/cosign.pub')
      return cosignPublicKey
    })
    expect(store.publishers.map(publisher => [publisher.name, publisher.keys.length, publisher.appIds, publisher.permissions])).toEqual([
      ['Example GmbH', 1, ['org.example.*'], ['studio.timeseries.read']],
      ['Other', 1, ['org.other.app'], []],
    ])
    expect(parseTrustStore('', '/').publishers).toEqual([])
  })

  it('reports every problem of the file', () => {
    const problems = (text: string) => {
      try {
        parseTrustStore(text, '/', () => {
          throw new Error('missing')
        })
      } catch (error) {
        return (error as TrustStoreError).problems
      }
      return []
    }
    const duplicate = cosignPublicKey.trim().split('\n').map(line => `        ${line}`).join('\n')
    expect(problems(`
publishers:
  - name: A
    keys:
      - |
${duplicate}
    appIds: [org.example.*]
    permissions: [studio.containers, studio.timeseries.read]
  - name: A
    keys:
      - |
${duplicate}
      - missing.pub
    appIds: [org.example.app]
`)).toEqual([
      'publishers[0].permissions[0]: studio.containers cannot be granted; only studio.timeseries.read can',
      'publishers[1].name: A is used twice',
      `publishers[1].keys[0]: the key ${parsePublicKey(cosignPublicKey).fingerprint} is listed for A already`,
      'publishers[1].keys[1]: missing.pub cannot be read',
    ])
    expect(problems('publishers: [{ name: A, keys: [], appIds: [Org.*], extra: 1 }]')).toEqual([
      'publishers[0].keys: Too small: expected array to have >=1 items',
      'publishers[0].appIds[0]: use app IDs such as org.example.app, prefixes such as org.example.*, or *',
      'publishers[0]: Unrecognized key: "extra"',
    ])
    expect(problems('publishers: [')[0]).toMatch(/^invalid YAML/)
    expect(() => parseTrustStore('version: 2', '/')).toThrow(TrustStoreError)
  })

  it('matches app IDs exactly, by prefix, or all', () => {
    expect(matchesAppId(['org.example.*'], 'org.example.app')).toBe(true)
    expect(matchesAppId(['org.example.*'], 'org.example.app.part')).toBe(true)
    expect(matchesAppId(['org.example.*'], 'org.example')).toBe(false)
    expect(matchesAppId(['org.example.*'], 'org.examples.app')).toBe(false)
    expect(matchesAppId(['org.example.app'], 'org.example.app')).toBe(true)
    expect(matchesAppId(['org.example.app'], 'org.example.app2')).toBe(false)
    expect(matchesAppId(['*'], 'com.any.app')).toBe(true)
  })
})

describe('signature verification against the trust store', () => {
  const signer = keyPair()
  const stranger = keyPair()
  const store = storeOf({ name: 'Example GmbH', pems: [cosignPublicKey, signer.pem], appIds: ['org.example.*'] })
  const bytes = zipApp(manifestOf({ id: 'org.example.app' }))

  it('accepts a valid signature of a trusted key within its patterns', () => {
    const verified = verifyPackageSignature(store, bytes, signPackage(bytes, signer.privateKey), 'org.example.app')
    expect(verified.publisher.name).toBe('Example GmbH')
    expect(verified.keyFingerprint).toBe(parsePublicKey(signer.pem).fingerprint)
    const bundle = readFileSync(join(cosign, 'org.example.signed-1.0.0.zip.bundle'), 'utf8')
    expect(verifyPackageSignature(store, signedZip, bundle, 'org.example.signed').keyFingerprint).toBe(parsePublicKey(cosignPublicKey).fingerprint)
  })

  it('refuses tampered packages, unknown keys and malformed signatures', () => {
    const signature = signPackage(bytes, signer.privateKey)
    const tampered = bytes.slice()
    tampered.set([tampered.at(-1)! ^ 1], tampered.length - 1)
    expect(problemOf(() => verifyPackageSignature(store, tampered, signature, 'org.example.app'))).toBe('app_signature_invalid')
    expect(problemOf(() => verifyPackageSignature(store, bytes, signPackage(bytes, stranger.privateKey), 'org.example.app'))).toBe('app_signature_invalid')
    expect(problemOf(() => verifyPackageSignature(store, bytes, 'bm90IGEgc2lnbmF0dXJl', 'org.example.app'))).toBe('app_signature_invalid')
    expect(problemOf(() => verifyPackageSignature({ publishers: [] }, bytes, signature, 'org.example.app'))).toBe('app_signature_invalid')
    // A bundle made for another package, even with a valid signature inside.
    const bundle = readFileSync(join(cosign, 'org.example.signed-1.0.0.zip.bundle'), 'utf8')
    expect(problemOf(() => verifyPackageSignature(store, bytes, bundle, 'org.example.app'))).toBe('app_signature_invalid')
  })

  it('refuses a trusted key outside its app ID patterns', () => {
    const signature = signPackage(bytes, signer.privateKey)
    expect(problemOf(() => verifyPackageSignature(store, bytes, signature, 'com.other.app'))).toBe('app_signer_not_allowed')
  })
})

describe('the trust of an installation', () => {
  const key = keyPair()
  const fingerprint = parsePublicKey(key.pem).fingerprint
  const store = storeOf({ name: 'Example GmbH', pems: [key.pem], appIds: ['org.example.*'], permissions: ['studio.timeseries.read'] })
  const signed = { appId: 'org.example.app', trust: 'signed', bundled: false, keyFingerprint: fingerprint, manifest: {} }

  it('grants the publisher\'s reserved permissions to signed apps, and all to bundled ones', () => {
    expect(installationTrust(signed, store)).toEqual({ verifiedPublisher: 'Example GmbH', revoked: null, granted: ['studio.timeseries.read'] })
    expect(installationTrust({ ...signed, trust: 'unsigned', keyFingerprint: null }, store)).toEqual({ verifiedPublisher: null, revoked: null, granted: [] })
    expect(installationTrust({ ...signed, trust: 'bundled', bundled: true, keyFingerprint: null }, store).granted).toContain('studio.containers')
  })

  it('revokes signed apps whose key was removed or no longer covers the app ID', () => {
    expect(installationTrust(signed, { publishers: [] }).revoked).toBe('keyRemoved')
    const narrowed = storeOf({ name: 'Example GmbH', pems: [key.pem], appIds: ['org.example.other'] })
    expect(installationTrust(signed, narrowed)).toEqual({ verifiedPublisher: 'Example GmbH', revoked: 'appIdNotAllowed', granted: [] })
  })
})

describe('the trust store and managed packages in the configuration', () => {
  const env = {
    STUDIO_PUBLIC_URL: 'https://studio.example.org',
    STUDIO_APPS_URL: 'https://apps.example.org',
    STUDIO_DATA_KEY: randomBytes(32).toString('base64url'),
    STUDIO_OIDC_ISSUER: 'https://idp.example.org/realms/x',
    STUDIO_OIDC_CLIENT_ID: 'studio',
  }

  it('reads the trust store file with keys next to it, and resolves package paths', () => {
    const directory = mkdtempSync(join(tmpdir(), 'studio-trust-'))
    mkdirSync(join(directory, 'keys'))
    writeFileSync(join(directory, 'keys', 'example.pub'), cosignPublicKey)
    writeFileSync(join(directory, 'trusted-publishers.yaml'), 'publishers:\n  - { name: Example GmbH, keys: [keys/example.pub], appIds: [org.example.*] }\n')
    const config = loadStudioConfig({ ...env, STUDIO_APPS_TRUSTED_PUBLISHERS: join(directory, 'trusted-publishers.yaml'), STUDIO_APP_PACKAGES: '/opt/apps,/opt/more/app.zip' }, 'hosted')
    expect(config.apps.trustStore.publishers.map(publisher => [publisher.name, publisher.keys[0]!.fingerprint])).toEqual([['Example GmbH', parsePublicKey(cosignPublicKey).fingerprint]])
    expect(config.apps.packages).toEqual(['/opt/apps', '/opt/more/app.zip'])
    expect(loadStudioConfig(env, 'hosted').apps).toMatchObject({ trustStore: { publishers: [] }, packages: [] })
  })

  it('refuses to start with a broken trust store', () => {
    const directory = mkdtempSync(join(tmpdir(), 'studio-trust-'))
    const file = join(directory, 'trusted-publishers.yaml')
    writeFileSync(file, 'publishers:\n  - { name: Example GmbH, keys: [missing.pub], appIds: [org.example.*] }\n')
    expect(() => loadStudioConfig({ ...env, STUDIO_APPS_TRUSTED_PUBLISHERS: file }, 'hosted')).toThrow(`STUDIO_APPS_TRUSTED_PUBLISHERS: ${file}: publishers[0].keys[0]: missing.pub cannot be read`)
    expect(() => loadStudioConfig({ ...env, STUDIO_APPS_TRUSTED_PUBLISHERS: join(directory, 'none.yaml') }, 'hosted')).toThrow(ConfigurationError)
  })
})
