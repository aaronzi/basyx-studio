import type { StudioConfig } from './config'
import { apiBasePath } from '#shared/contract'

export const callbackPath = `${apiBasePath}/auth/callback`

/**
 * Redirect URI for authorization responses. Hosted: under the public URL.
 * Desktop: an RFC 8252 loopback URI on the local service's port, with the
 * loopback host the IdP registration expects (`127.0.0.1` or `localhost`).
 */
export function callbackUri (config: StudioConfig, loopbackHost?: '127.0.0.1' | 'localhost'): string {
  const base = new URL(config.publicUrl)
  if (config.deploymentMode === 'desktop' && loopbackHost) {
    base.hostname = loopbackHost
  }
  return new URL(callbackPath, base).href
}
