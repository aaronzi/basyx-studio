import { relative, resolve } from 'node:path'
import { build } from 'esbuild'
import { defineNuxtModule } from 'nuxt/kit'

/** Bundles the Workspace Worker entry and its dependencies into one ES module. */
export async function bundleWorkspaceWorker (rootDir: string, outfile: string, sourcemap = false): Promise<void> {
  await build({
    entryPoints: [resolve(rootDir, 'server/workers/workspace-worker.ts')],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    sourcemap: sourcemap ? 'inline' : false,
    alias: { '#shared': resolve(rootDir, 'shared') },
    // Bundled CommonJS dependencies may still call require().
    banner: { js: 'import { createRequire as __studioCreateRequire } from \'node:module\'; const require = __studioCreateRequire(import.meta.url);' },
    logLevel: 'warning',
  })
}

/**
 * Bundles the Workspace Worker (server/workers/workspace-worker.ts) into one
 * file next to the Nitro server, so the Studio Service can fork it: into
 * `.output/server/` for builds and into the build directory for `nuxt dev`.
 */
export default defineNuxtModule({
  meta: { name: 'studio-workspace-worker' },
  setup (_, nuxt) {
    const rootDir = nuxt.options.rootDir
    const bundle = (outfile: string) => bundleWorkspaceWorker(rootDir, outfile, nuxt.options.dev)

    if (nuxt.options.dev) {
      const outfile = resolve(nuxt.options.buildDir, 'workspace-worker.mjs')
      nuxt.options.runtimeConfig.studio = { ...nuxt.options.runtimeConfig.studio, workspaceWorker: outfile }
      nuxt.hook('nitro:init', () => bundle(outfile).then(() => {}))
      nuxt.hook('builder:watch', async (_event, path) => {
        const file = relative(rootDir, resolve(rootDir, path))
        if (file.startsWith('server/lib/') || file.startsWith('server/workers/') || file.startsWith('shared/')) {
          await bundle(outfile)
        }
      })
      return
    }

    nuxt.hook('nitro:init', nitro => {
      nitro.hooks.hook('compiled', async () => {
        await bundle(resolve(nitro.options.output.serverDir, 'workspace-worker.mjs'))
      })
    })
  },
})
