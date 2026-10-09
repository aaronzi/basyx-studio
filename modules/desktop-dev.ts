import { randomBytes } from 'node:crypto'
import { defineNuxtModule } from 'nuxt/kit'

/**
 * `nuxt dev --envName electron` runs the Studio Service in the dev server, not
 * as a child of the Electron main process. Both inherit this process's
 * environment, so the broker secret they share is set here.
 */
export default defineNuxtModule({
  meta: { name: 'studio-desktop-dev' },
  setup (_, nuxt) {
    if (nuxt.options.dev && nuxt.options.runtimeConfig.studio?.deploymentMode === 'desktop') {
      process.env.STUDIO_BROKER_SECRET ??= randomBytes(32).toString('base64url')
    }
  },
})
