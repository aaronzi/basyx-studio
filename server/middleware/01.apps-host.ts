import { createError, defineEventHandler, getRequestHost } from 'nuxt/server'
import { appsHostOf } from '../lib/apps/origins'
import { useStudio } from '../utils/studio'

/**
 * The apps origin serves app files only (ADR 0017): never Studio pages or
 * the Studio API, so app code cannot reach them as same-origin requests.
 * With one origin per installation (ADR 0045), every host of the pattern
 * is an apps origin; the file route serves each only its own files.
 */
export default defineEventHandler(async event => {
  // Probes answer on every host and before the Studio runtime is ready.
  if (event.url.pathname.startsWith('/health/')) {
    return
  }
  const studio = await useStudio()
  const { baseUrl } = studio.config.apps
  if (!baseUrl || studio.config.deploymentMode === 'desktop' || event.url.pathname.startsWith('/app/')) {
    return
  }
  if (appsHostOf(baseUrl, getRequestHost(event))) {
    throw createError({ status: 404, statusText: 'Not Found' })
  }
})
