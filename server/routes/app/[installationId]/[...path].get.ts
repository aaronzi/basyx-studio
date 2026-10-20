import { createError, defineEventHandler, getRequestHost, getRouterParam } from 'nuxt/server'
import { appContentSecurityPolicy } from '~~/server/lib/apps/csp'
import { appBaseUrl, appsHostOf, coversStudioOrigin, hasInstallationOrigins } from '~~/server/lib/apps/origins'
import { readAppFile } from '~~/server/lib/apps/store'
import { allowedOrigins } from '~~/server/lib/urls'
import { hasBrokerSecret } from '~~/server/utils/desktop'
import { useStudio } from '~~/server/utils/studio'

/**
 * Serves the files of installed apps (ADR 0017). Hosted, only on the apps
 * origin, and with one origin per installation only on the installation's
 * own (ADR 0045). On desktop, only to the Electron main process, which
 * serves them to the renderer under the `studio-app:` protocol.
 */
export default defineEventHandler(async event => {
  const studio = await useStudio()
  const { baseUrl } = studio.config.apps
  const desktop = studio.config.deploymentMode === 'desktop'
  const installationId = getRouterParam(event, 'installationId') ?? ''
  const path = getRouterParam(event, 'path', { decode: true }) ?? ''
  const host = baseUrl === null || desktop ? null : appsHostOf(baseUrl, getRequestHost(event))
  const allowed = baseUrl !== null && (desktop ? hasBrokerSecret(event) : host !== null && (host.installationId === null || host.installationId === installationId))
  const file = allowed ? await readAppFile(studio, installationId, path) : null
  if (!file) {
    throw createError({ status: 404, statusText: 'Not Found' })
  }
  const studioOrigins = allowedOrigins(studio.config.publicUrl, desktop)
  const headers = event.res.headers
  headers.set('Content-Type', file.contentType)
  headers.set('Content-Security-Policy', appContentSecurityPolicy(appBaseUrl(baseUrl!, installationId), studioOrigins, file.sandbox, {
    sameOrigin: hasInstallationOrigins(baseUrl!),
    // Refused at install; dropped here too, in case Studio's URLs changed since.
    excludeOrigin: entry => coversStudioOrigin(entry, studioOrigins, baseUrl),
  }))
  headers.set('X-Content-Type-Options', 'nosniff')
  headers.set('Referrer-Policy', 'no-referrer')
  if (!desktop) {
    // Sandboxed documents cannot set document.domain; this keeps it so. Not
    // under studio-app:, where the header makes Electron 44 stop.
    headers.set('Origin-Agent-Cluster', '?1')
  }
  // With a shared apps origin the frame is opaque, so module scripts are
  // CORS requests with `Origin: null`; Studio's page reads entries to tell
  // why a frame did not start. App files are not secret and carry no cookies.
  headers.set('Access-Control-Allow-Origin', '*')
  headers.set('Cross-Origin-Resource-Policy', 'cross-origin')
  headers.set('Cache-Control', 'no-cache')
  headers.set('ETag', `"${file.digest}"`)
  return file.content
})
