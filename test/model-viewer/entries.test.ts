import { execFileSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// The viewer's parsers per format (external apps follow-up plan B1): an
// app that registers only `ifcParser` builds without occt-import-js's
// WebAssembly and the STEP worker. Built as `pnpm apps:build` builds it.

const example = fileURLToPath(new URL('../../examples/apps/inventory', import.meta.url))

describe('an IFC-only build', () => {
  it('holds web-ifc and its worker, and nothing of STEP', () => {
    execFileSync('pnpm', ['exec', 'vite', 'build', '--logLevel', 'error'], { cwd: example, stdio: 'pipe', shell: process.platform === 'win32' })
    const files = readdirSync(join(example, 'dist', 'ui', 'assets'))
    expect(files.some(file => /^web-ifc-.*\.wasm$/.test(file))).toBe(true)
    expect(files.some(file => /^ifc\.worker-.*\.js$/.test(file))).toBe(true)
    expect(files.filter(file => /occt|step/i.test(file))).toEqual([])
  }, 120_000)
})
