// Builds examples/apps/starter as a repository of its own would (ADR 0043,
// P6): packs @basyx/studio-sdk, @basyx/studio-app-kit and @basyx/model-viewer,
// installs them from the tarballs into a copy of the example outside this
// repository, runs its typecheck, unit tests and build, packs, signs and
// verifies its package with `studio-app`, and opens its dev server in a
// browser on the test transport. Anything that still reaches into this
// repository fails here.
//   node scripts/check-app-tarballs.mjs [--keep] [--no-browser]
import { execFileSync, spawn } from 'node:child_process'
import { generateKeyPairSync } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

const { values: options } = parseArgs({ options: { 'keep': { type: 'boolean' }, 'no-browser': { type: 'boolean' } } })
const root = fileURLToPath(new URL('..', import.meta.url))
const packages = ['studio-sdk', 'studio-app-kit', 'model-viewer']
const work = mkdtempSync(join(tmpdir(), 'studio-app-tarballs-'))
const tarballs = join(work, 'tarballs')
const app = join(work, 'app')
const windows = process.platform === 'win32'

function run (command, args, cwd) {
  console.info(`\n$ ${command} ${args.join(' ')}   (${cwd.startsWith(work) ? relative(work, cwd) : relative(root, cwd)})`)
  execFileSync(command, args, { cwd, stdio: 'inherit', shell: windows })
}

function check (condition, message) {
  if (!condition) {
    throw new Error(message)
  }
}

/** Everything a published package's manifest names must be in its tarball, and no workspace link may remain. */
function checkTarball (file) {
  const unpacked = join(work, 'unpacked', basename(file, '.tgz'))
  mkdirSync(unpacked, { recursive: true })
  execFileSync('tar', ['-xzf', file, '-C', unpacked])
  const manifest = JSON.parse(readFileSync(join(unpacked, 'package', 'package.json'), 'utf8'))
  const text = JSON.stringify(manifest)
  check(!text.includes('workspace:'), `${manifest.name}: the packed package.json still has a workspace: range`)
  const targetsOf = value => typeof value === 'string' ? [value] : Object.values(value ?? {}).flatMap(item => targetsOf(item))
  const targets = [...targetsOf(manifest.exports), ...targetsOf(manifest.bin)]
  for (const target of targets) {
    check(target.startsWith('./dist/') || target.endsWith('.json'), `${manifest.name}: ${target} is not built output`)
    check(existsSync(join(unpacked, 'package', target)), `${manifest.name}: ${target} is missing from the tarball`)
  }
  console.info(`${basename(file)}: ${targets.length} entries, ${manifest.version}`)
  return manifest
}

try {
  // 1. Build and pack the packages, as the release workflow does.
  for (const name of packages) {
    const directory = join(root, 'packages', name)
    run('pnpm', ['run', 'build'], directory)
    run('pnpm', ['pack', '--pack-destination', tarballs], directory)
  }
  const files = Object.fromEntries(readdirSync(tarballs).map(file => {
    const manifest = checkTarball(join(tarballs, file))
    return [manifest.name, `file:../tarballs/${file}`]
  }))

  // 2. The example outside this repository, with the tarballs instead of
  //    the registry versions, and the pnpm version of this repository.
  cpSync(join(root, 'examples', 'apps', 'starter'), app, {
    recursive: true,
    filter: source => !/[/\\](?:node_modules|dist)$|\.zip(?:\.sig)?$/.test(source),
  })
  const manifest = JSON.parse(readFileSync(join(app, 'package.json'), 'utf8'))
  for (const name of Object.keys(files)) {
    check(manifest.dependencies[name], `The starter does not depend on ${name}`)
    manifest.dependencies[name] = files[name]
  }
  manifest.packageManager = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).packageManager
  writeFileSync(join(app, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  const overrides = Object.entries(files).map(([name, file]) => `  "${name}": "${file}"`).join('\n')
  writeFileSync(join(app, 'pnpm-workspace.yaml'), `${readFileSync(join(app, 'pnpm-workspace.yaml'), 'utf8')}\noverrides:\n${overrides}\n`)

  // 3. What the example's own CI would run.
  run('pnpm', ['install'], app)
  run('pnpm', ['run', 'typecheck'], app)
  run('pnpm', ['test'], app)
  run('pnpm', ['run', 'build'], app)
  run('pnpm', ['run', 'package'], app)
  const packageFile = 'org.example.studio.starter-0.1.0.zip'
  check(existsSync(join(app, packageFile)), `studio-app pack did not write ${packageFile}`)
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
  writeFileSync(join(work, 'signing.pem'), privateKey.export({ type: 'pkcs8', format: 'pem' }))
  writeFileSync(join(work, 'signing.pub'), publicKey.export({ type: 'spki', format: 'pem' }))
  run('pnpm', ['exec', 'studio-app', 'sign', packageFile, '--key', join(work, 'signing.pem')], app)
  run('pnpm', ['exec', 'studio-app', 'verify', packageFile, '--key', join(work, 'signing.pub')], app)

  // 4. The dev server on the test transport, in a browser.
  if (!options['no-browser']) {
    await checkDevServer()
  }
  console.info('\nThe starter builds, packs and runs from the packed packages.')
} finally {
  if (options.keep) {
    console.info(`Kept ${work}`)
  } else {
    rmSync(work, { recursive: true, force: true })
  }
}

async function checkDevServer () {
  const port = 5179
  // Vite itself, not through pnpm, so that stopping it stops the server.
  const vite = join(app, 'node_modules', 'vite', 'bin', 'vite.js')
  const server = spawn(process.execPath, [vite, '--port', String(port), '--strictPort'], { cwd: app, stdio: ['ignore', 'pipe', 'inherit'] })
  const { chromium } = await import('@playwright/test')
  const browser = await chromium.launch()
  try {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('The dev server did not start.')), 60_000)
      server.on('exit', code => reject(new Error(`The dev server exited with ${code}.`)))
      server.stdout.on('data', chunk => {
        process.stdout.write(chunk)
        if (String(chunk).includes(`localhost:${port}`)) {
          clearTimeout(timeout)
          resolve()
        }
      })
    })
    const page = await browser.newPage()
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    page.on('console', message => message.type() === 'error' && errors.push(message.text()))
    await page.goto(`http://localhost:${port}/?locale=de`)
    await page.getByText('Verwaltungsschalen in Demo target').waitFor({ timeout: 60_000 })
    await page.locator('[data-test=shells]').getByText('Pump 01').click()
    await page.locator('[data-test=model]').first().waitFor()
    const models = await page.locator('[data-test=model]').allInnerTexts()
    check(models.length === 2 && models[0].includes('pump.ifc'), `The shell page shows ${JSON.stringify(models)}`)
    // Studio's Vuetify Sass settings, not Vuetify's stock CSS: 14 px list titles.
    const titleSize = await page.locator('.v-list-item-title').first().evaluate(element => getComputedStyle(element).fontSize)
    check(titleSize === '14px', `List titles are ${titleSize}; the dev server did not compile Vuetify with Studio's settings`)
    check(errors.length === 0, `The page reported errors:\n${errors.join('\n')}`)
    console.info('The dev server runs the app on the test transport.')
  } finally {
    await browser.close()
    server.kill()
  }
}
