import type { Finding } from '@basyx/studio-app-kit/manifest'
import { execFileSync } from 'node:child_process'
import { createHash, generateKeyPairSync, randomBytes, verify } from 'node:crypto'
import { mkdtempSync } from 'node:fs'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkPackage, packApp } from '@basyx/studio-app-kit/package'
import { keyFingerprint, signPackage, verifyPackageSignature } from '@basyx/studio-app-kit/signature'
import { strToU8, zipSync } from 'fflate'
import { afterAll, describe, expect, it } from 'vitest'
import { readAppPackage } from '~~/server/lib/apps/package'
import { StudioProblem } from '~~/server/lib/problem'
import { manifestOf, zipApp } from './support'

// The app kit's package checks, packing and signatures (ADR 0043): the same
// findings as Studio's upload, and the signature format of the plan's U1.

/** What Studio's upload reports, with the runtime left unchecked as `studio-app verify` does. */
function uploadFindings (bytes: Uint8Array): Finding[] {
  try {
    readAppPackage(bytes, null)
    return []
  } catch (error) {
    if (error instanceof StudioProblem) {
      return error.violations ?? []
    }
    throw error
  }
}

const manifest = JSON.stringify(manifestOf())

describe('checkPackage', () => {
  it.each([
    ['a valid package', zipApp(manifestOf())],
    ['a folder archive with litter', zipSync({ 'app/studio-app.json': strToU8(manifest), 'app/ui/index.html': strToU8('x'), 'app/.DS_Store': strToU8('x') })],
    ['not a ZIP file', strToU8('not a zip')],
    ['an unsafe entry name', zipSync({ 'studio-app.json': strToU8(manifest), '../evil.js': strToU8('x') })],
    ['an entry above 20 MiB', zipSync({ 'studio-app.json': strToU8(manifest), 'ui/blob.png': randomBytes(21 * 1024 * 1024) }, { level: 0 })],
    ['a suspicious compression ratio', zipSync({ 'studio-app.json': strToU8(manifest), 'ui/zeros.txt': new Uint8Array(15 * 1024 * 1024) })],
    ['forbidden file types', zipApp(manifestOf(), { 'ui/index.html': 'x', 'run.sh': '#!/bin/sh' })],
    ['no manifest', zipApp(null)],
    ['a manifest that is not JSON', zipApp('{')],
    ['schema violations', zipApp({ ...manifestOf(), id: 'NoDots', extra: true } as never)],
    ['a missing entry and backend', zipApp(manifestOf({ backend: { runtime: 'deno', entry: 'backend/main.js' } }))],
    ['another app API', zipApp(manifestOf({ studioApi: '^2.0.0' }))],
  ])('reports what Studio’s upload reports for %s', (_name, bytes) => {
    const findings = checkPackage(bytes).findings.map(finding => ({
      ...finding,
      message: finding.message.replace('the installed @basyx/studio-sdk', 'this Studio'),
    }))
    expect(findings).toEqual(uploadFindings(bytes))
  })

  it('returns the manifest and files of a valid package', () => {
    const check = checkPackage(zipApp(manifestOf(), { 'ui/index.html': 'x', 'ui/app.js': 'y' }))
    expect(check.manifest?.id).toBe('org.example.test')
    expect(check.files.toSorted()).toEqual(['ui/app.js', 'ui/index.html'])
  })
})

describe('packApp', () => {
  const directories: string[] = []
  afterAll(() => Promise.all(directories.map(directory => rm(directory, { recursive: true, force: true }))))

  async function project (files: Record<string, string>): Promise<string> {
    const directory = mkdtempSync(join(tmpdir(), 'studio-app-'))
    directories.push(directory)
    for (const [path, content] of Object.entries(files)) {
      await mkdir(join(directory, path, '..'), { recursive: true })
      await writeFile(join(directory, path), content)
    }
    return directory
  }

  const backendManifest = JSON.stringify(manifestOf({ permissions: ['studio.backend'], backend: { runtime: 'deno', entry: 'backend/main.js' } }))

  it('packages the manifest, dist/ and included folders as <id>-<version>.zip', async () => {
    const directory = await project({
      'studio-app.json': backendManifest,
      'dist/ui/index.html': '<!doctype html>',
      'dist/ui/.DS_Store': 'x',
      'backend/main.js': 'export function x () {}',
      'src/main.ts': 'not packaged',
    })
    const result = await packApp({ project: directory, include: ['backend'] })
    expect(result.findings).toEqual([])
    expect(result.file).toBe(join(directory, 'org.example.test-1.0.0.zip'))
    const check = checkPackage(new Uint8Array(await readFile(result.file!)))
    expect(check.files.toSorted()).toEqual(['backend/main.js', 'ui/index.html'])
    expect(readAppPackage(result.bytes!, 'hosted').manifest.backend?.entry).toBe('backend/main.js')
  })

  it('writes the same bytes for the same files', async () => {
    const directory = await project({ 'studio-app.json': manifest, 'dist/ui/index.html': 'x', 'dist/ui/a.js': 'y' })
    const first = await packApp({ project: directory, output: 'one.zip' })
    const second = await packApp({ project: directory, output: join(directory, 'out') })
    expect(second.file).toBe(join(directory, 'out', 'org.example.test-1.0.0.zip'))
    expect(Buffer.from(second.bytes!).equals(Buffer.from(first.bytes!))).toBe(true)
  })

  it('writes nothing when the package has findings', async () => {
    const missingDist = await packApp({ project: await project({ 'studio-app.json': manifest }) })
    expect(missingDist).toMatchObject({ file: null, findings: [{ path: 'dist', message: 'does not exist; build the app first' }] })

    const missingEntry = await packApp({ project: await project({ 'studio-app.json': backendManifest, 'dist/ui/index.html': 'x' }) })
    expect(missingEntry.file).toBeNull()
    expect(missingEntry.findings).toEqual([{ path: 'studio-app.json#backend.entry', message: 'names "backend/main.js", which is not in the package' }])
  })
})

describe('package signatures', () => {
  const bytes = zipApp(manifestOf())
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
  const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' })
  const publicPem = publicKey.export({ type: 'spki', format: 'pem' })

  it('signs the exact bytes with ECDSA P-256 and SHA-256, as DER in base64 (cosign sign-blob)', () => {
    const signature = signPackage(bytes, privatePem)
    const der = Buffer.from(signature, 'base64')
    expect(der[0]).toBe(0x30)
    expect(verify('sha256', bytes, { key: publicKey, dsaEncoding: 'der' }, der)).toBe(true)
    expect(verifyPackageSignature(bytes, `${signature}\n`, publicPem)).toBe(true)
  })

  it('refuses other bytes, other keys and malformed signatures', () => {
    const signature = signPackage(bytes, privateKey)
    const tampered = Uint8Array.from(bytes)
    tampered[20]! ^= 1
    expect(verifyPackageSignature(tampered, signature, publicPem)).toBe(false)
    expect(verifyPackageSignature(bytes, signature, generateKeyPairSync('ec', { namedCurve: 'P-256' }).publicKey)).toBe(false)
    expect(verifyPackageSignature(bytes, 'not base64!', publicPem)).toBe(false)
  })

  it('reads the message signature of a Sigstore bundle, cosign 3’s default', () => {
    const signature = signPackage(bytes, privateKey)
    const bundle = (digest: Uint8Array) => JSON.stringify({
      mediaType: 'application/vnd.dev.sigstore.bundle.v0.3+json',
      verificationMaterial: { publicKey: { hint: 'x' } },
      messageSignature: { messageDigest: { algorithm: 'SHA2_256', digest: Buffer.from(digest).toString('base64') }, signature },
    })
    const digest = createHash('sha256').update(bytes).digest()
    expect(verifyPackageSignature(bytes, bundle(digest), publicPem)).toBe(true)
    expect(verifyPackageSignature(bytes, bundle(new Uint8Array(32)), publicPem)).toBe(false)
    expect(verifyPackageSignature(bytes, '{"mediaType":"application/json"}', publicPem)).toBe(false)
  })

  it('reads SEC1 and encrypted PKCS#8 keys, and refuses keys other than P-256', () => {
    const sec1 = privateKey.export({ type: 'sec1', format: 'pem' })
    expect(verifyPackageSignature(bytes, signPackage(bytes, sec1), publicPem)).toBe(true)
    const encrypted = privateKey.export({ type: 'pkcs8', format: 'pem', cipher: 'aes-256-cbc', passphrase: 'secret' })
    expect(verifyPackageSignature(bytes, signPackage(bytes, encrypted, 'secret'), publicPem)).toBe(true)
    expect(() => signPackage(bytes, generateKeyPairSync('ec', { namedCurve: 'P-384' }).privateKey)).toThrow('not an ECDSA P-256 key')
    expect(() => signPackage(bytes, generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey)).toThrow('not an ECDSA P-256 key')
  })

  it('tells keys apart by the SHA-256 of their public key', () => {
    expect(keyFingerprint(publicPem)).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(keyFingerprint(privatePem)).toBe(keyFingerprint(publicPem))
  })
})

describe('the studio-app command from source', () => {
  const cli = fileURLToPath(new URL('../../packages/studio-app-kit/src/cli.ts', import.meta.url))
  const run = (cwd: string, ...args: string[]) => execFileSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8', stdio: 'pipe' })

  it('packs, signs and verifies a package', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'studio-app-cli-'))
    try {
      await mkdir(join(directory, 'dist', 'ui'), { recursive: true })
      await writeFile(join(directory, 'studio-app.json'), manifest)
      await writeFile(join(directory, 'dist', 'ui', 'index.html'), '<!doctype html>')
      const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
      await writeFile(join(directory, 'key.pem'), privateKey.export({ type: 'pkcs8', format: 'pem' }))
      await writeFile(join(directory, 'key.pub'), publicKey.export({ type: 'spki', format: 'pem' }))

      expect(run(directory, 'pack')).toContain('org.example.test-1.0.0.zip')
      expect(run(directory, 'sign', 'org.example.test-1.0.0.zip', '--key', 'key.pem')).toContain('signed with sha256:')
      expect(run(directory, 'verify', 'org.example.test-1.0.0.zip', '--key', 'key.pub')).toContain('signed by sha256:')

      await writeFile(join(directory, 'org.example.test-1.0.0.zip'), zipApp(manifestOf({ studioApi: '^9.0.0' })))
      expect(() => run(directory, 'verify', 'org.example.test-1.0.0.zip')).toThrow(/requires Studio app API \^9\.0\.0/)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})
