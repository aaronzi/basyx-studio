import type { AppInstallationRecord } from './store'
import { createHmac, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto'
import semver from 'semver'

// Views of other apps inline in an app's page (`studio.ui.embedView`,
// ADR 0051). The view's frame URL carries a token that Studio signs: only
// the document it names may be framed by the embedding app, and Studio's
// page connects the view only with a token it handed to that app.

/** What one embed token allows: the embedding origin to frame one entry of one installation, until it expires. */
export interface EmbedClaims {
  /** The installation of the view. */
  installationId: string
  /** The view's entry, the only file the token applies to. */
  path: string
  /** The origin of the embedding installation, added to the entry's `frame-ancestors`. */
  embedderOrigin: string
  /** Expiry, milliseconds since the epoch. */
  expiresAt: number
}

export const embedTokenPrefix = 'sev.'
export const embedTokenTtlMs = 60 * 60_000

/** The first app API version whose SDK connects from inside another app's page. */
export const embedViewApiVersion = '0.1.11'

export function embedTokenKey (dataKey: Buffer): Buffer {
  return Buffer.from(hkdfSync('sha256', dataKey, Buffer.alloc(0), 'studio-app-embed-token', 32))
}

function sign (key: Buffer, payload: string): string {
  return createHmac('sha256', key).update(payload).digest('base64url')
}

/**
 * Signs an embed token. Every token is unique: Studio's page knows an
 * embedded view's submodel by its token, so two views of the same entry
 * embedded at once must not share one.
 */
export function issueEmbedToken (key: Buffer, claims: Omit<EmbedClaims, 'expiresAt'>, now = Date.now()): string {
  const payload = Buffer.from(JSON.stringify({
    i: claims.installationId,
    p: claims.path,
    o: claims.embedderOrigin,
    e: now + embedTokenTtlMs,
    n: randomBytes(8).toString('base64url'),
  })).toString('base64url')
  return `${embedTokenPrefix}${payload}.${sign(key, payload)}`
}

/** The claims of a valid, unexpired token, or `null`. */
export function verifyEmbedToken (key: Buffer, token: string, now = Date.now()): EmbedClaims | null {
  if (!token.startsWith(embedTokenPrefix) || token.length > 2000) {
    return null
  }
  const [payload, mac, ...rest] = token.slice(embedTokenPrefix.length).split('.')
  if (!payload || !mac || rest.length > 0) {
    return null
  }
  const expected = Buffer.from(sign(key, payload))
  const provided = Buffer.from(mac)
  if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) {
    return null
  }
  let claims: { i?: unknown, p?: unknown, o?: unknown, e?: unknown }
  try {
    claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
  } catch {
    return null
  }
  if (typeof claims.i !== 'string' || typeof claims.p !== 'string' || typeof claims.o !== 'string' || typeof claims.e !== 'number' || claims.e <= now) {
    return null
  }
  return { installationId: claims.i, path: claims.p, embedderOrigin: claims.o, expiresAt: claims.e }
}

/**
 * Whether a view can be embedded: it ships with Studio, or its manifest
 * excludes app API versions whose SDK would say hello to the embedding app
 * instead of Studio's page.
 */
export function isEmbeddable (installation: Pick<AppInstallationRecord, 'bundled' | 'manifest'>): boolean {
  if (installation.bundled) {
    return true
  }
  const lowest = semver.validRange(installation.manifest.studioApi) ? semver.minVersion(installation.manifest.studioApi) : null
  return lowest !== null && semver.gte(lowest, embedViewApiVersion)
}
