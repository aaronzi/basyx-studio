// Builds apps and packages each as an installable app package:
//   node scripts/build-example-apps.mjs                      examples/apps/* → examples/apps/dist/<name>.zip
//   node scripts/build-example-apps.mjs apps server/bundled-apps   bundled apps (ADR 0023)
// Packages are written by the app kit, with the checks of Studio's upload
// (ADR 0043). An app with its own pnpm-workspace.yaml is a repository of its
// own (examples/apps/starter); scripts/check-app-tarballs.mjs builds it from
// the packed packages.
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readdir } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { packApp } from '@basyx/studio-app-kit/package'

const root = fileURLToPath(new URL('..', import.meta.url))
const examples = join(root, process.argv[2] ?? join('examples', 'apps'))
const output = process.argv[3] ? join(root, process.argv[3]) : join(examples, 'dist')

await mkdir(output, { recursive: true })
for (const name of await readdir(examples)) {
  const directory = join(examples, name)
  if (!existsSync(join(directory, 'studio-app.json')) || existsSync(join(directory, 'pnpm-workspace.yaml'))) {
    continue
  }
  execFileSync('pnpm', ['exec', 'vite', 'build', '--logLevel', 'warn'], { cwd: directory, stdio: 'inherit', shell: process.platform === 'win32' })
  // The UI build lands in dist/ui/; backend files keep their folder.
  const result = await packApp({
    project: directory,
    include: existsSync(join(directory, 'backend')) ? ['backend'] : [],
    output: join(output, `${name}.zip`),
  })
  if (!result.file) {
    const findings = result.findings.map(finding => `  ${finding.path}: ${finding.message}`).join('\n')
    throw new Error(`${relative(root, directory)}: the package has findings:\n${findings}`)
  }
  console.info(`${relative(root, result.file)}: ${result.files.length + 1} files`)
}
