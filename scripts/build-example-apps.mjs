// Builds apps and packages each as an installable app package:
//   node scripts/build-example-apps.mjs                      examples/apps/* → examples/apps/dist/<name>.zip
//   node scripts/build-example-apps.mjs apps server/bundled-apps   bundled apps (ADR 0023)
// Packages are written by the app kit, with the checks of Studio's upload
// (ADR 0043). An app with its own pnpm-workspace.yaml is a repository of its
// own (examples/apps/starter); scripts/check-app-tarballs.mjs builds it from
// the packed packages. The apps build side by side, one per CPU core.
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readdir } from 'node:fs/promises'
import { availableParallelism } from 'node:os'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { packApp } from '@basyx/studio-app-kit/package'

const root = fileURLToPath(new URL('..', import.meta.url))
const examples = join(root, process.argv[2] ?? join('examples', 'apps'))
const output = process.argv[3] ? join(root, process.argv[3]) : join(examples, 'dist')

function viteBuild (directory) {
  return new Promise((resolve, reject) => {
    const child = spawn('pnpm', ['exec', 'vite', 'build', '--logLevel', 'warn'], { cwd: directory, stdio: 'inherit', shell: process.platform === 'win32' })
    child.on('error', reject)
    child.on('exit', code => code === 0 ? resolve() : reject(new Error(`${relative(root, directory)}: vite build exited with ${code}`)))
  })
}

async function build (name) {
  const directory = join(examples, name)
  await viteBuild(directory)
  // The UI build lands in dist/ui/; backend files and the OpenAPI documents
  // of connections (ADR 0047) keep their folder.
  const result = await packApp({
    project: directory,
    include: ['backend', 'api'].filter(folder => existsSync(join(directory, folder))),
    output: join(output, `${name}.zip`),
  })
  if (!result.file) {
    const findings = result.findings.map(finding => `  ${finding.path}: ${finding.message}`).join('\n')
    throw new Error(`${relative(root, directory)}: the package has findings:\n${findings}`)
  }
  console.info(`${relative(root, result.file)}: ${result.files.length + 1} files`)
}

await mkdir(output, { recursive: true })
const names = (await readdir(examples)).filter(name => existsSync(join(examples, name, 'studio-app.json')) && !existsSync(join(examples, name, 'pnpm-workspace.yaml')))
const queue = [...names]
await Promise.all(Array.from({ length: Math.min(names.length, availableParallelism()) }, async () => {
  for (let name = queue.shift(); name; name = queue.shift()) {
    await build(name)
  }
}))
