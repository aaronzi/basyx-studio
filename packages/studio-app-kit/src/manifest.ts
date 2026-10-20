import type { AppManifest } from '@basyx/studio-sdk/protocol'
import type { ErrorObject, ValidateFunction } from 'ajv/dist/2020.js'
import manifestSchema from '@basyx/studio-sdk/app-manifest.schema.json' with { type: 'json' }
import { studioAppApiVersion } from '@basyx/studio-sdk/protocol'
import addFormats from 'ajv-formats'
import Ajv2020 from 'ajv/dist/2020.js'
import semver from 'semver'

// What a Studio app package must be (ADR 0016), in one place for Studio's
// upload (server/lib/apps) and for `studio-app pack` and `verify` (ADR 0043).
// Without Node or browser APIs, so both can use it.

/** A problem with a package: where (`studio-app.json#permissions`, a file path) and what. */
export interface Finding {
  path: string
  message: string
}

/** Where Studio runs an app. */
export type AppRuntime = AppManifest['runtimes'][number]

export const manifestFileName = 'studio-app.json'

export const maxManifestBytes = 64 * 1024

/** Limits of a ZIP archive, checked from its central directory before anything is decompressed. */
export interface ArchiveLimits {
  maxArchiveBytes: number
  maxEntries: number
  maxEntryBytes: number
  maxTotalBytes: number
  /** Highest compression ratio accepted for entries above `ratioThresholdBytes`. */
  maxCompressionRatio: number
  ratioThresholdBytes: number
}

const MiB = 1024 * 1024

/** Developer-mode uploads are small; the marketplace may allow more. */
export const appArchiveLimits: ArchiveLimits = {
  maxArchiveBytes: 20 * MiB,
  maxEntries: 2000,
  maxEntryBytes: 20 * MiB,
  maxTotalBytes: 50 * MiB,
  maxCompressionRatio: 100,
  ratioThresholdBytes: MiB,
}

/**
 * File types an app package may contain, with the content type they are
 * served with. Content types are never sniffed.
 */
export const appContentTypes: Readonly<Record<string, string>> = {
  html: 'text/html; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8',
  json: 'application/json',
  map: 'application/json',
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  avif: 'image/avif',
  ico: 'image/x-icon',
  woff2: 'font/woff2',
  woff: 'font/woff',
  ttf: 'font/ttf',
  otf: 'font/otf',
  eot: 'application/vnd.ms-fontobject',
  wasm: 'application/wasm',
  txt: 'text/plain; charset=utf-8',
}

export function contentTypeOf (path: string): string | null {
  const extension = /\.([a-z0-9]+)$/i.exec(path)?.[1]?.toLowerCase()
  return extension ? (appContentTypes[extension] ?? null) : null
}

/** Archive litter from desktop file managers, skipped instead of rejected. */
export function isArchiveLitter (path: string): boolean {
  return path.startsWith('__MACOSX/') || /(?:^|\/)(?:\.DS_Store|Thumbs\.db)$/.test(path)
}

let validator: ValidateFunction<AppManifest> | undefined

/** The public manifest JSON Schema (ADR 0016), compiled once. */
function validateSchema (): ValidateFunction<AppManifest> {
  if (!validator) {
    const ajv = new Ajv2020({ allErrors: true, strict: true })
    addFormats(ajv, ['uri'])
    validator = ajv.compile<AppManifest>(manifestSchema)
  }
  return validator
}

function describe (error: ErrorObject): Finding {
  const path = `${manifestFileName}${error.instancePath ? error.instancePath.replaceAll('/', '.').replace(/^\./, '#') : ''}`
  let message = error.message ?? 'is invalid'
  if (error.keyword === 'additionalProperties') {
    message = `has the unknown property ${JSON.stringify(error.params.additionalProperty)}`
  } else if (error.keyword === 'enum') {
    message = `must be one of ${(error.params.allowedValues as unknown[]).map(value => JSON.stringify(value)).join(', ')}`
  }
  return { path, message }
}

/** Validates the manifest against the schema. Returns the findings, or the typed manifest. */
export function parseManifest (text: string): { manifest: AppManifest, findings: [] } | { manifest: null, findings: Finding[] } {
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    return { manifest: null, findings: [{ path: manifestFileName, message: 'is not valid JSON' }] }
  }
  const validate = validateSchema()
  if (!validate(json)) {
    return { manifest: null, findings: (validate.errors ?? []).map(error => describe(error)) }
  }
  return { manifest: json, findings: [] }
}

/** Checks that do not fit JSON Schema: unique IDs and routes, and entries that exist. */
export function checkManifestConsistency (manifest: AppManifest, files: ReadonlySet<string>): Finding[] {
  const findings: Finding[] = []
  const ids = new Set<string>()
  const routes = new Set<string>()
  const contributions = [
    ...(manifest.contributes.submodelViews ?? []).map((item, index) => ({ item, at: `contributes.submodelViews[${index}]` })),
    ...(manifest.contributes.modules ?? []).map((item, index) => ({ item, at: `contributes.modules[${index}]` })),
  ]
  if (contributions.length === 0) {
    findings.push({ path: `${manifestFileName}#contributes`, message: 'must contribute at least one submodel view or module' })
  }
  for (const { item, at } of contributions) {
    if (ids.has(item.id)) {
      findings.push({ path: `${manifestFileName}#${at}.id`, message: `duplicates the contribution ID ${JSON.stringify(item.id)}` })
    }
    ids.add(item.id)
    if (!files.has(item.entry)) {
      findings.push({ path: `${manifestFileName}#${at}.entry`, message: `names ${JSON.stringify(item.entry)}, which is not in the package` })
    }
    if ('route' in item) {
      if (routes.has(item.route)) {
        findings.push({ path: `${manifestFileName}#${at}.route`, message: `duplicates the route ${JSON.stringify(item.route)}` })
      }
      routes.add(item.route)
    }
  }
  const hasBackendPermission = manifest.permissions.includes('studio.backend')
  if (manifest.backend) {
    if (!files.has(manifest.backend.entry)) {
      findings.push({ path: `${manifestFileName}#backend.entry`, message: `names ${JSON.stringify(manifest.backend.entry)}, which is not in the package` })
    }
    if (!hasBackendPermission) {
      findings.push({ path: `${manifestFileName}#permissions`, message: 'must include studio.backend when the app has a backend' })
    }
  } else if (hasBackendPermission) {
    findings.push({ path: `${manifestFileName}#permissions`, message: 'requests studio.backend, but the app has no backend' })
  }
  return findings
}

export interface CompatibilityOptions {
  /** The app API to check against; by default the one of the installed `@basyx/studio-sdk`. */
  apiVersion?: string
  /** Who provides it, for the message. Default `this Studio`. */
  provider?: string
}

/** Technical compatibility: the app API range, and the runtime (`null` checks none). */
export function checkCompatibility (manifest: AppManifest, runtime: AppRuntime | null, options: CompatibilityOptions = {}): Finding[] {
  const { apiVersion = studioAppApiVersion, provider = 'this Studio' } = options
  const findings: Finding[] = []
  const range = semver.validRange(manifest.studioApi)
  if (!range) {
    findings.push({ path: `${manifestFileName}#studioApi`, message: `is not a valid version range: ${JSON.stringify(manifest.studioApi)}` })
  } else if (!semver.satisfies(apiVersion, range)) {
    findings.push({ path: `${manifestFileName}#studioApi`, message: `requires Studio app API ${manifest.studioApi}; ${provider} provides ${apiVersion}` })
  }
  if (runtime && !manifest.runtimes.includes(runtime)) {
    findings.push({ path: `${manifestFileName}#runtimes`, message: `does not include ${runtime}` })
  }
  return findings
}
