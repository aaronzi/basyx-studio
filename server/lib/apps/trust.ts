import type { AppPermission, AppRevocation } from '#shared/contract'
import type { SigningKey } from '@basyx/studio-app-kit/signature'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parsePublicKey, parseSignature, SignatureFormatError, verifySignature } from '@basyx/studio-app-kit/signature'
import { parseDocument } from 'yaml'
import { z } from 'zod'
import { StudioProblem } from '../problem'

// The trust store (ADR 0044): publishers whose keys may sign app packages,
// each limited to app ID patterns, read from STUDIO_APPS_TRUSTED_PUBLISHERS.
//
//   version: 1
//   publishers:
//     - name: Example GmbH
//       keys: [keys/example.pub]          # PEM text, or a path relative to this file
//       appIds: [org.example.*]
//       permissions: [studio.timeseries.read]

/** Reserved permissions a trust store entry may grant; `studio.containers` stays with bundled apps (ADR 0033). */
export const grantablePermissions = ['studio.timeseries.read'] as const satisfies readonly AppPermission[]
export type GrantablePermission = typeof grantablePermissions[number]

export interface TrustedPublisher {
  name: string
  keys: SigningKey[]
  /** App IDs, prefixes ending in `.*`, or `*`. */
  appIds: string[]
  permissions: GrantablePermission[]
}

export interface TrustStore {
  publishers: TrustedPublisher[]
}

export const emptyTrustStore: TrustStore = { publishers: [] }

export class TrustStoreError extends Error {
  constructor (readonly problems: string[]) {
    super(problems.join('; '))
  }
}

// The manifest's app ID pattern (app-manifest.schema.json), optionally ending in `.*`.
const appIdPattern = /^(?:\*|[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)*(?:\.\*)?)$/

const fileSchema = z.object({
  version: z.literal(1).optional(),
  publishers: z.array(z.object({
    name: z.string().trim().min(1).max(200),
    keys: z.array(z.string().min(1)).min(1),
    appIds: z.array(z.string().regex(appIdPattern, 'use app IDs such as org.example.app, prefixes such as org.example.*, or *')).min(1),
    permissions: z.array(z.string()).default([]),
  }).strict()).nullish(),
}).strict()

function problemPath (path: PropertyKey[]): string {
  return path.reduce<string>((text, segment) => typeof segment === 'number' ? `${text}[${segment}]` : `${text}${text ? '.' : ''}${String(segment)}`, '')
}

/**
 * Reads a trust store file and reports every problem with its place. Keys
 * given as paths are read relative to `baseDirectory`.
 */
export function parseTrustStore (text: string, baseDirectory: string, readKeyFile: (path: string) => string = path => readFileSync(path, 'utf8')): TrustStore {
  const document = parseDocument(text)
  if (document.errors.length > 0) {
    throw new TrustStoreError([`invalid YAML: ${document.errors[0]!.message.split('\n', 1)[0]}`])
  }
  const parsed = fileSchema.safeParse(document.toJS() ?? {})
  if (!parsed.success) {
    throw new TrustStoreError(parsed.error.issues.map(issue => `${problemPath(issue.path) || '(file)'}: ${issue.message}`))
  }

  const problems: string[] = []
  const publishers: TrustedPublisher[] = []
  const names = new Set<string>()
  const owners = new Map<string, string>()
  for (const [index, entry] of (parsed.data.publishers ?? []).entries()) {
    const at = `publishers[${index}]`
    if (names.has(entry.name)) {
      problems.push(`${at}.name: ${entry.name} is used twice`)
    }
    names.add(entry.name)

    const keys: SigningKey[] = []
    for (const [keyIndex, value] of entry.keys.entries()) {
      const keyAt = `${at}.keys[${keyIndex}]`
      let pem = value
      if (!value.includes('-----BEGIN')) {
        try {
          pem = readKeyFile(resolve(baseDirectory, value))
        } catch {
          problems.push(`${keyAt}: ${value} cannot be read`)
          continue
        }
      }
      try {
        const key = parsePublicKey(pem)
        const owner = owners.get(key.fingerprint)
        if (owner !== undefined) {
          problems.push(`${keyAt}: the key ${key.fingerprint} is listed for ${owner} already`)
          continue
        }
        owners.set(key.fingerprint, entry.name)
        keys.push(key)
      } catch (error) {
        problems.push(`${keyAt}: ${error instanceof SignatureFormatError ? error.message : 'cannot be read'}`)
      }
    }

    const permissions: GrantablePermission[] = []
    for (const [permissionIndex, permission] of entry.permissions.entries()) {
      if ((grantablePermissions as readonly string[]).includes(permission)) {
        permissions.push(permission as GrantablePermission)
      } else {
        problems.push(`${at}.permissions[${permissionIndex}]: ${permission} cannot be granted; only ${grantablePermissions.join(', ')} can`)
      }
    }
    publishers.push({ name: entry.name, keys, appIds: entry.appIds, permissions })
  }
  if (problems.length > 0) {
    throw new TrustStoreError(problems)
  }
  return { publishers }
}

export function matchesAppId (patterns: readonly string[], appId: string): boolean {
  return patterns.some(pattern => pattern === '*' || pattern === appId || (pattern.endsWith('.*') && appId.startsWith(pattern.slice(0, -1))))
}

export interface VerifiedSignature {
  publisher: TrustedPublisher
  keyFingerprint: string
}

/**
 * Verifies a package signature against the trust store: the signature must
 * be valid for a trusted key, and the app ID within that key's publisher's
 * patterns. Throws `app_signature_invalid` or `app_signer_not_allowed`.
 */
export function verifyPackageSignature (store: TrustStore, bytes: Uint8Array, signatureText: string, appId: string): VerifiedSignature {
  let parsed
  try {
    parsed = parseSignature(signatureText)
  } catch (error) {
    throw new StudioProblem('app_signature_invalid', `The signature cannot be read: ${error instanceof SignatureFormatError ? error.message : 'unknown format'}.`)
  }
  if (parsed.digest && parsed.digest !== `sha256:${createHash('sha256').update(bytes).digest('hex')}`) {
    throw new StudioProblem('app_signature_invalid', 'The signature was made for another package.')
  }
  for (const publisher of store.publishers) {
    for (const key of publisher.keys) {
      if (parsed.keyFingerprint && parsed.keyFingerprint !== key.fingerprint) {
        continue
      }
      if (!verifySignature(bytes, parsed.signature, key.key)) {
        continue
      }
      if (!matchesAppId(publisher.appIds, appId)) {
        throw new StudioProblem('app_signer_not_allowed', `${publisher.name} signed the package, but may sign ${publisher.appIds.join(', ')} only, not ${appId}.`)
      }
      return { publisher, keyFingerprint: key.fingerprint }
    }
  }
  throw new StudioProblem('app_signature_invalid', 'The signature does not match the package with any key of a trusted publisher (STUDIO_APPS_TRUSTED_PUBLISHERS).')
}

export interface InstallationTrust {
  /** The trust store's name of the publisher, for signed installations whose key is trusted. */
  verifiedPublisher: string | null
  revoked: AppRevocation | null
  /** Reserved permissions the installation may use beyond its manifest's ordinary ones. */
  granted: AppPermission[]
}

/** The fields of an installation that its trust depends on. */
export interface TrustFields {
  appId: string
  trust: string
  bundled: boolean
  keyFingerprint: string | null
}

/**
 * The current trust of an installation (ADR 0044). The trust store is read at
 * startup, so a removed key revokes its installations at the next start.
 */
export function installationTrust (installation: TrustFields, store: TrustStore): InstallationTrust {
  if (installation.bundled) {
    return { verifiedPublisher: null, revoked: null, granted: [...grantablePermissions, 'studio.containers'] }
  }
  if (installation.trust !== 'signed') {
    return { verifiedPublisher: null, revoked: null, granted: [] }
  }
  const publisher = store.publishers.find(entry => entry.keys.some(key => key.fingerprint === installation.keyFingerprint))
  if (!publisher) {
    return { verifiedPublisher: null, revoked: 'keyRemoved', granted: [] }
  }
  if (!matchesAppId(publisher.appIds, installation.appId)) {
    return { verifiedPublisher: publisher.name, revoked: 'appIdNotAllowed', granted: [] }
  }
  return { verifiedPublisher: publisher.name, revoked: null, granted: publisher.permissions }
}
