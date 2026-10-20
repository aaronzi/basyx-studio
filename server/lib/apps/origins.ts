import { originCovers } from '@basyx/studio-app-kit/manifest'

// Where app files are served (ADR 0017, ADR 0045). The apps base URL ends in
// `/` and is one of:
//   - `https://apps.example.org/app/`: one shared apps origin, opaque frames;
//   - `https://{installation}.apps.example.org/app/`: one origin per
//     installation, frames with `allow-same-origin`;
//   - `studio-app://` on desktop, where the installation is the host, so
//     every installation has its own origin as well.

/** The placeholder for the installation ID in STUDIO_APPS_URL. */
export const installationPlaceholder = '{installation}'

const installationLabel = 'app-[0-9a-f]{16}'

/** Whether every installation has an origin of its own. */
export function hasInstallationOrigins (baseUrl: string): boolean {
  return baseUrl.includes(installationPlaceholder) || baseUrl.startsWith('studio-app:')
}

/** The URL prefix of an installation's files, ending in `/`. */
export function appBaseUrl (baseUrl: string, installationId: string): string {
  if (baseUrl.startsWith('studio-app:')) {
    return `${baseUrl}${installationId}/`
  }
  return `${baseUrl.replace(installationPlaceholder, installationId)}${installationId}/`
}

/** The URL of a file of an installation on the apps origin. */
export function appFileUrl (baseUrl: string, installationId: string, path: string): string {
  return `${appBaseUrl(baseUrl, installationId)}${path}`
}

/** The origin a frame of the installation runs in, or `null` when frames share one origin and stay opaque. */
export function appFrameOrigin (baseUrl: string, installationId: string): string | null {
  if (!hasInstallationOrigins(baseUrl)) {
    return null
  }
  const match = /^[a-z][a-z0-9+.-]*:\/\/[^/]+/.exec(appBaseUrl(baseUrl, installationId))
  return match ? match[0] : null
}

/** The host (with port) of the apps origin, `{installation}` included for the pattern. */
function appsHost (baseUrl: string): string {
  return /^[a-z][a-z0-9+.-]*:\/\/([^/]+)/.exec(baseUrl)?.[1] ?? ''
}

function escape (text: string): string {
  return text.replaceAll(/[$()*+.?[\\\]^{|}]/g, String.raw`\$&`)
}

/**
 * What a request host is to the apps origin: the shared apps host, the host
 * of one installation, or `null` for any other host (Studio's own).
 */
export function appsHostOf (baseUrl: string, host: string): { installationId: string | null } | null {
  const pattern = appsHost(baseUrl).toLowerCase()
  host = host.toLowerCase()
  if (!pattern.includes(installationPlaceholder)) {
    return host === pattern ? { installationId: null } : null
  }
  const match = new RegExp(`^${escape(pattern).replace(escape(installationPlaceholder), `(${installationLabel})`)}$`).exec(host)
  return match ? { installationId: match[1]! } : null
}

/**
 * Whether a manifest origin entry (ADR 0045) covers Studio's own origins or an
 * apps origin. Such entries are refused: Studio would answer the requests as
 * same-site, with the user's cookies.
 */
export function coversStudioOrigin (entry: string, studioOrigins: Iterable<string>, baseUrl: string | null): boolean {
  for (const origin of studioOrigins) {
    if (originCovers(entry, origin)) {
      return true
    }
  }
  if (!baseUrl || baseUrl.startsWith('studio-app:')) {
    return false
  }
  const scheme = baseUrl.slice(0, baseUrl.indexOf('://'))
  const host = appsHost(baseUrl)
  if (!host.includes(installationPlaceholder)) {
    return originCovers(entry, `${scheme}://${host}`)
  }
  // A wildcard covers the installations' hosts if it covers one of them; an
  // exact entry if its host is one of them.
  const sample = `${scheme}://${host.replace(installationPlaceholder, 'app-0000000000000000')}`
  const exact = /^https?:\/\/([^/]+)$/.exec(entry)?.[1]
  return originCovers(entry, sample) || (exact !== undefined && entry.startsWith(`${scheme}://`) && appsHostOf(baseUrl, exact) !== null)
}
