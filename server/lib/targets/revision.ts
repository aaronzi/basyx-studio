import { createHash } from 'node:crypto'
import { StudioProblem } from '../problem'

/**
 * Studio revision tokens are opaque to the UI:
 * - `h.<hash>`: hash of a live element as read. A write reads the element
 *   again, compares the hash, and writes conditionally on the fresh ETag;
 * - `w.<revision>`: revision of a desktop workspace model.
 */
export type RevisionToken
  = | { kind: 'hash', hash: string }
    | { kind: 'workspace', revision: number }

const hashPattern = /^[\w-]{43}$/

/** Key-order independent JSON, so equal content always hashes equally. */
function canonical (value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(item => canonical(item)).join(',')}]`
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .toSorted(([a], [b]) => (a < b ? -1 : (a > b ? 1 : 0)))
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`
  }
  return JSON.stringify(value)
}

export function contentHash (value: unknown): string {
  return createHash('sha256').update(canonical(value)).digest('base64url')
}

export function formatRevision (token: RevisionToken): string {
  return token.kind === 'hash' ? `h.${token.hash}` : `w.${token.revision}`
}

/** Parses an `If-Match` value as sent by the UI (quoted or bare). */
export function parseRevision (value: string | undefined): RevisionToken {
  if (!value) {
    throw new StudioProblem('precondition_required')
  }
  const text = value.trim().replace(/^"(.*)"$/, '$1')
  const [kind, body, ...rest] = text.split('.')
  if (rest.length === 0 && body) {
    if (kind === 'h' && hashPattern.test(body)) {
      return { kind: 'hash', hash: body }
    }
    if (kind === 'w' && /^\d{1,15}$/.test(body)) {
      return { kind: 'workspace', revision: Number(body) }
    }
  }
  throw new StudioProblem('invalid_request', 'Malformed revision.')
}
