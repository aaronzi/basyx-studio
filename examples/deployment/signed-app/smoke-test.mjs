// Smoke test of the signed app example (ADR 0044, external apps plan phase C):
// signs app packages with cosign, starts the stack with a Studio image, and
// checks through Studio's API what an administrator would do:
//
// - an unsigned upload is refused; a signed package installs without
//   developer mode, after an inspection that names the verified publisher;
// - a higher version updates in place with the same installation ID;
// - a tampered package, an unknown key and an app ID outside the key's
//   patterns are refused;
// - a signed package in STUDIO_APP_PACKAGES is installed as managed;
// - removing the key revokes the apps it signed at the next start, and
//   adding it again restores them.
//
//   STUDIO_IMAGE=basyx-studio:dev node examples/deployment/signed-app/smoke-test.mjs
//
// cosign comes from the PATH, else from its container image (COSIGN_IMAGE).
// KEEP_STACK=1 leaves the stack running afterwards.

import { execFileSync, spawnSync } from 'node:child_process'
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { request } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { crc32, deflateRawSync } from 'node:zlib'

const directory = dirname(fileURLToPath(import.meta.url))
const project = process.env.SMOKE_PROJECT ?? 'basyx-studio-signed-app-smoke'
const port = process.env.STUDIO_PORT ?? '3992'
const work = mkdtempSync(join(tmpdir(), 'studio-signed-app-'))
const env = {
  ...process.env,
  STUDIO_PORT: port,
  STUDIO_IMAGE: process.env.STUDIO_IMAGE ?? 'eclipsebasyx/basyx-studio:SNAPSHOT',
  STUDIO_TRUST_DIR: join(work, 'trust'),
  STUDIO_PACKAGES_DIR: join(work, 'packages'),
}
const base = `http://localhost:${port}`
const api = `${base}/api/studio/v1`
const cosignImage = process.env.COSIGN_IMAGE ?? 'ghcr.io/sigstore/cosign/cosign:v3.0.2'
const password = 'smoke-test'

function compose (...args) {
  return execFileSync('docker', ['compose', '-p', project, '-f', `${directory}/compose.yaml`, ...args], { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
}

function fail (message) {
  throw new Error(message)
}

function check (condition, message) {
  if (!condition) {
    fail(message)
  }
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

async function waitFor (what, probe, seconds = 120) {
  for (let elapsed = 0; elapsed < seconds; elapsed += 2) {
    if (await probe().catch(() => false)) {
      return
    }
    await sleep(2000)
  }
  fail(`${what} within ${seconds} s`)
}

// cosign, installed or as a container that sees the work directory.
const local = spawnSync('cosign', ['version'], { encoding: 'utf8' }).status === 0
function cosign (...args) {
  const options = { cwd: work, env: { ...process.env, COSIGN_PASSWORD: password }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
  const run = list => local
    ? spawnSync('cosign', list, options)
    : spawnSync('docker', ['run', '--rm', '-u', `${process.getuid()}`, '-e', 'HOME=/w', '-e', 'COSIGN_PASSWORD', '-v', `${work}:/w`, '-w', '/w', cosignImage, ...list], options)
  const result = run(args)
  if (result.status !== 0) {
    fail(`cosign ${args.join(' ')} failed: ${result.stderr}`)
  }
  return result.stdout
}

/** Signs a package as a team's CI does; cosign 2 does not know --use-signing-config. */
function sign (name, key) {
  const args = ['sign-blob', '--yes', '--key', `keys/${key}.key`, '--tlog-upload=false', '--output-signature', `${name}.sig`, name]
  try {
    cosign(...args.slice(0, 4), '--use-signing-config=false', ...args.slice(4))
  } catch (error) {
    if (!String(error.message).includes('unknown flag: --use-signing-config')) {
      throw error
    }
    cosign(...args)
  }
  // cosign writes 0600; Studio runs as another user in its container.
  chmodSync(join(work, `${name}.sig`), 0o644)
  return readFileSync(join(work, `${name}.sig`), 'utf8').trim()
}

/** A ZIP archive of deflated entries; the smoke test runs without dependencies. */
function zip (entries) {
  const locals = []
  const centrals = []
  let offset = 0
  for (const [name, text] of Object.entries(entries)) {
    const path = Buffer.from(name)
    const data = Buffer.from(text)
    const deflated = deflateRawSync(data)
    // Local header: version, flags, method (deflate), time, date, CRC, sizes, name length.
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04_03_4B_50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(8, 8)
    local.writeUInt16LE(((2026 - 1980) << 9) | (10 << 5) | 20, 12)
    local.writeUInt32LE(crc32(data), 14)
    local.writeUInt32LE(deflated.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(path.length, 26)
    // The central header has the same fields after "version made by", and the local header's offset.
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02_01_4B_50, 0)
    central.writeUInt16LE(20, 4)
    local.copy(central, 6, 4, 30)
    central.writeUInt32LE(offset, 42)
    locals.push(local, path, deflated)
    centrals.push(central, path)
    offset += local.length + path.length + deflated.length
  }
  const directory = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06_05_4B_50, 0)
  end.writeUInt16LE(centrals.length / 2, 8)
  end.writeUInt16LE(centrals.length / 2, 10)
  end.writeUInt32LE(directory.length, 12)
  end.writeUInt32LE(offset, 16)
  return new Uint8Array(Buffer.concat([...locals, directory, end]))
}

function pack (name, manifest, html) {
  const bytes = zip({
    'studio-app.json': JSON.stringify({
      manifestVersion: 0,
      publisher: { name: 'Smoke test team' },
      title: { en: `Signed smoke test ${manifest.version}` },
      studioApi: '^0.1.0',
      runtimes: ['hosted'],
      permissions: ['studio.aas.read'],
      contributes: { submodelViews: [{ id: 'view', title: { en: 'View' }, entry: 'ui/index.html', semanticIds: ['urn:example:signed-smoke'] }] },
      ...manifest,
    }),
    'ui/index.html': `<!doctype html><title>x</title><p>${html}</p>`,
  })
  writeFileSync(join(work, name), bytes)
  return bytes
}

function trustStore (withKey) {
  writeFileSync(join(work, 'trust', 'trusted-publishers.yaml'), [
    'version: 1',
    'publishers:',
    ...(withKey ? ['  - name: Smoke Team', '    keys: [keys/team.pub]', '    appIds: [org.example.*]'] : []),
    '',
  ].join('\n'))
}

let cookie = ''
let csrf = ''

async function signIn () {
  // An anonymous session, as a browser gets it with the first page.
  const page = await fetch(`${base}/`, { headers: { Accept: 'text/html' } })
  cookie = page.headers.getSetCookie().map(value => value.split(';', 1)[0]).join('; ')
  const session = await call('GET', '/session')
  check(session.status === 200, `GET /session answered ${session.status}`)
  csrf = session.body.csrfToken
}

async function call (method, path, body, headers = {}) {
  const binary = body instanceof Uint8Array
  const response = await fetch(`${api}${path}`, {
    method,
    headers: {
      Cookie: cookie,
      Accept: 'application/json',
      ...(body === undefined ? {} : { 'Content-Type': binary ? 'application/zip' : 'application/json', 'Origin': base, 'X-CSRF-Token': csrf }),
      ...headers,
    },
    body: body === undefined || binary ? body : JSON.stringify(body),
  })
  const text = await response.text()
  return { status: response.status, body: text ? JSON.parse(text) : null }
}

function upload (bytes, signature, inspect = false) {
  return call('POST', `/app-installations${inspect ? '?inspect=true' : ''}`, bytes, signature ? { 'Studio-App-Signature': signature } : {})
}

async function installations () {
  const { status, body } = await call('GET', '/app-installations')
  check(status === 200, `GET /app-installations answered ${status}`)
  return body.items
}

/** A file from the apps origin, which is routed to the same service. */
function appFile (installationId) {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path: `/app/${installationId}/ui/index.html`, headers: { Host: `apps.localhost:${port}` } }, response => {
      let text = ''
      response.on('data', chunk => (text += chunk))
      response.on('end', () => resolve({ status: response.statusCode, text }))
    })
    req.on('error', reject)
    req.end()
  })
}

async function restart () {
  compose('restart', 'studio')
  await waitFor('Studio did not become ready after the restart', async () => (await fetch(`${base}/health/ready`)).ok)
  await signIn()
}

async function run () {
  for (const sub of ['keys', 'trust/keys', 'packages']) {
    mkdirSync(join(work, sub), { recursive: true })
  }
  console.log(`cosign: ${local ? 'from the PATH' : cosignImage}`)
  cosign('generate-key-pair', '--output-key-prefix', 'keys/team')
  cosign('generate-key-pair', '--output-key-prefix', 'keys/stranger')
  copyFileSync(join(work, 'keys', 'team.pub'), join(work, 'trust', 'keys', 'team.pub'))
  trustStore(true)

  const v1 = pack('app-1.0.0.zip', { id: 'org.example.signed-smoke', version: '1.0.0' }, 'version 1.0.0')
  const v1Signature = sign('app-1.0.0.zip', 'team')
  const v11 = pack('app-1.1.0.zip', { id: 'org.example.signed-smoke', version: '1.1.0', permissions: ['studio.aas.read', 'studio.ui.notifications'] }, 'version 1.1.0')
  const v11Signature = sign('app-1.1.0.zip', 'team')
  const v12 = pack('app-1.2.0.zip', { id: 'org.example.signed-smoke', version: '1.2.0' }, 'version 1.2.0')
  const strangerSignature = sign('app-1.2.0.zip', 'stranger')
  const foreign = pack('foreign.zip', { id: 'com.other.signed-smoke', version: '1.0.0' }, 'foreign')
  const foreignSignature = sign('foreign.zip', 'team')
  pack('packages/managed.zip', { id: 'org.example.managed-smoke', version: '2.0.0' }, 'managed')
  sign('packages/managed.zip', 'team')
  for (const path of ['', 'trust', 'trust/keys', 'packages']) {
    chmodSync(join(work, path), 0o755)
  }

  console.log(`Starting the signed app example with ${env.STUDIO_IMAGE}`)
  compose('up', '-d', '--quiet-pull')
  await waitFor('Studio did not become ready', async () => (await fetch(`${base}/health/ready`)).ok)
  await signIn()

  const managed = (await installations()).find(item => item.appId === 'org.example.managed-smoke')
  check(managed?.managed && managed.trust === 'signed' && managed.verifiedPublisher === 'Smoke Team', `the managed package is not installed as signed: ${JSON.stringify(managed)}`)
  console.log(`Managed package: ${managed.appId} ${managed.version}, signed by ${managed.verifiedPublisher}`)

  const unsigned = await upload(v1, null)
  check(unsigned.status === 403 && unsigned.body.code === 'app_unsigned_disabled', `an unsigned upload answered ${unsigned.status} ${unsigned.body?.code}`)

  const inspection = await upload(v1, v1Signature, true)
  check(inspection.status === 200 && inspection.body.trust === 'signed' && inspection.body.verifiedPublisher === 'Smoke Team' && inspection.body.update === null, `the inspection is wrong: ${JSON.stringify(inspection.body)}`)
  check(!(await installations()).some(item => item.appId === 'org.example.signed-smoke'), 'the inspection installed the app')

  const installed = await upload(v1, v1Signature)
  check(installed.status === 201 && installed.body.trust === 'signed', `the signed install answered ${installed.status}: ${JSON.stringify(installed.body)}`)
  const { id } = installed.body
  check((await appFile(id)).text.includes('version 1.0.0'), 'the app origin does not serve version 1.0.0')
  console.log(`Signed install without developer mode: ${id}, ${installed.body.keyFingerprint}`)

  const update = await upload(v11, v11Signature, true)
  check(update.status === 200 && update.body.update?.installationId === id && update.body.update.permissionsAdded.join(',') === 'studio.ui.notifications', `the update inspection is wrong: ${JSON.stringify(update.body)}`)
  const updated = await upload(v11, v11Signature)
  check(updated.status === 200 && updated.body.id === id && updated.body.version === '1.1.0', `the update answered ${updated.status}: ${JSON.stringify(updated.body)}`)
  check((await appFile(id)).text.includes('version 1.1.0'), 'the app origin does not serve version 1.1.0')
  console.log(`Updated in place: ${id} is now 1.1.0`)

  const refusals = [
    ['the same version', await upload(v11, v11Signature), 409, 'app_already_installed'],
    ['a tampered package', await upload(v12, v11Signature), 422, 'app_signature_invalid'],
    ['an unknown key', await upload(v12, strangerSignature), 422, 'app_signature_invalid'],
    ['an app ID outside the key\'s patterns', await upload(foreign, foreignSignature), 403, 'app_signer_not_allowed'],
  ]
  for (const [what, answer, status, code] of refusals) {
    check(answer.status === status && answer.body.code === code, `${what} answered ${answer.status} ${answer.body?.code}`)
  }
  console.log(`Refused: ${refusals.map(([what]) => what).join(', ')}`)

  trustStore(false)
  await restart()
  const revoked = (await installations()).filter(item => item.revoked === 'keyRemoved').map(item => item.appId).toSorted()
  check(revoked.join(',') === 'org.example.managed-smoke,org.example.signed-smoke', `the apps were not revoked: ${revoked}`)
  check((await appFile(id)).status === 404, 'the app origin still serves a revoked app')
  const revokedCall = await call('POST', '/app-calls', { installationId: id, method: 'studio.aas.listShells', params: {} })
  check(revokedCall.status === 403 && revokedCall.body.code === 'app_revoked', `a revoked app's call answered ${revokedCall.status} ${revokedCall.body?.code}`)
  const views = await call('GET', '/app-contributions?semanticId=urn:example:signed-smoke')
  check(views.status === 200 && views.body.submodelViews.length === 0, 'a revoked app still contributes views')
  check(compose('logs', 'studio').includes('org.example.signed-smoke 1.1.0 is revoked'), 'the log does not report the revocation')
  console.log(`Revoked after removing the key: ${revoked.join(', ')}`)

  trustStore(true)
  await restart()
  const restored = (await installations()).find(item => item.id === id)
  check(restored && !restored.revoked && restored.version === '1.1.0', `the app was not restored: ${JSON.stringify(restored)}`)
  check((await appFile(id)).text.includes('version 1.1.0'), 'the app origin does not serve the restored app')
  console.log('Restored after adding the key again')
}

try {
  await run()
  console.log('Signed app smoke test passed')
} catch (error) {
  console.error(`Signed app smoke test failed: ${error.message}`)
  try {
    console.error(compose('logs', '--tail', '80', 'studio'))
  } catch {
    // The stack did not start.
  }
  process.exitCode = 1
} finally {
  if (!process.env.KEEP_STACK) {
    compose('down', '-v')
    rmSync(work, { recursive: true, force: true })
  }
}
