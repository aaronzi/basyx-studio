// Builds a package of packages/ for publication (ADR 0043): an empty dist/,
// the ESM, declarations and source maps from tsconfig.build.json, and the
// files named as arguments, copied from src/ to dist/ (e.g. Sass).
//   cd packages/studio-app-kit && node ../../scripts/build-package.mjs settings.scss
import { execFileSync } from 'node:child_process'
import { cpSync, rmSync } from 'node:fs'
import { join } from 'node:path'

const directory = process.cwd()
rmSync(join(directory, 'dist'), { recursive: true, force: true })
execFileSync('pnpm', ['exec', 'tsc', '-p', 'tsconfig.build.json'], { cwd: directory, stdio: 'inherit', shell: process.platform === 'win32' })
for (const file of process.argv.slice(2)) {
  cpSync(join(directory, 'src', file), join(directory, 'dist', file))
}
