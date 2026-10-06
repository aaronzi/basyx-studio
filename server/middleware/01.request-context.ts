import { randomUUID } from 'node:crypto'
import { apiBasePath } from '#shared/contract'

const unsafeMethods = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

function allowedOrigins (publicUrl: string, desktop: boolean): Set<string> {
  const origins = new Set([new URL(publicUrl).origin])
  if (desktop) {
    // The desktop renderer may address the loopback service by either name.
    const url = new URL(publicUrl)
    origins.add(`${url.protocol}//localhost:${url.port}`)
    origins.add(`${url.protocol}//127.0.0.1:${url.port}`)
  }
  return origins
}

export default defineEventHandler(async event => {
  event.context.requestId = randomUUID()
  if (!event.path.startsWith(apiBasePath)) {
    return
  }
  setResponseHeader(event, 'X-Request-ID', event.context.requestId)
  setResponseHeader(event, 'Cache-Control', 'no-store')

  // Reject cross-site state changes before any handler runs. Browsers always
  // send Origin on these methods; the CSRF token check follows per handler.
  if (unsafeMethods.has(event.method)) {
    const studio = await useStudio()
    const origin = getHeader(event, 'origin')
    if (!origin || !allowedOrigins(studio.config.publicUrl, studio.config.deploymentMode === 'desktop').has(origin)) {
      setResponseStatus(event, 403)
      setResponseHeader(event, 'Content-Type', 'application/problem+json')
      return {
        type: 'about:blank',
        title: 'Request origin or CSRF token rejected',
        status: 403,
        code: 'csrf_rejected',
        requestId: event.context.requestId,
        retryable: false,
      }
    }
  }
})
