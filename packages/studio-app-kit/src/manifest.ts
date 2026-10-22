import type { ApiIndex, OperationValidators } from './openapi.ts'
import type { AppManifest, AppSetting, SandboxOriginKind } from '@basyx/studio-sdk/protocol'
import type { ErrorObject, ValidateFunction } from 'ajv/dist/2020.js'
import manifestSchema from '@basyx/studio-sdk/app-manifest.schema.json' with { type: 'json' }
import { appSettingLimits, connectionIdRule, sandboxOriginKinds, studioAppApiVersion } from '@basyx/studio-sdk/protocol'
import addFormats from 'ajv-formats'
import Ajv2020 from 'ajv/dist/2020.js'
import semver from 'semver'
import { compileApi, indexApi, maxApiDocumentBytes } from './openapi.ts'

export * from './openapi.ts'

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
  } else if (error.keyword === 'pattern' && /^\/sandbox\/\w+Origins\/\d+$/.test(error.instancePath)) {
    message = 'must be an origin in lower case without a path: https://host[:port], optionally https://*.example.org, or http:// for localhost, names below .localhost or 127.0.0.1. IPv6 literals such as [::1] cannot be used in a Content Security Policy; use localhost'
  } else if (error.keyword === 'pattern' && /^\/connections\/\d+\/id$/.test(error.instancePath)) {
    message = `must be ${connectionIdRule}, such as weather-api: the administrator's binding and studio.connections.call name the connection by this ID`
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
  const hasConnectionsPermission = manifest.permissions.includes('studio.connections')
  const connectionIds = new Set<string>()
  for (const [index, connection] of (manifest.connections ?? []).entries()) {
    if (connectionIds.has(connection.id)) {
      findings.push({ path: `${manifestFileName}#connections[${index}].id`, message: `duplicates the connection ID ${JSON.stringify(connection.id)}` })
    }
    connectionIds.add(connection.id)
    if (!files.has(connection.api)) {
      findings.push({ path: `${manifestFileName}#connections[${index}].api`, message: `names ${JSON.stringify(connection.api)}, which is not in the package` })
    }
  }
  if (connectionIds.size > 0 && !hasConnectionsPermission) {
    findings.push({ path: `${manifestFileName}#permissions`, message: 'must include studio.connections when the app declares connections' })
  } else if (connectionIds.size === 0 && hasConnectionsPermission) {
    findings.push({ path: `${manifestFileName}#permissions`, message: 'requests studio.connections, but the app declares no connections' })
  }
  findings.push(...checkSettingDeclarations(manifest))
  for (const kind of sandboxOriginKinds) {
    for (const [index, origin] of (manifest.sandbox?.[kind] ?? []).entries()) {
      const port = Number(/:(\d+)$/.exec(origin)?.[1] ?? 0)
      if (port > 65_535) {
        findings.push({ path: `${manifestFileName}#sandbox.${kind}[${index}]`, message: `has the port ${port}, which does not exist` })
      }
    }
  }
  findings.push(...checkFeatureVersions(manifest))
  return findings
}

/** Manifest fields that older Studios do not know, with the app API version that brought them. */
function usedFeatures (manifest: AppManifest): { path: string, since: string }[] {
  const features: { path: string, since: string }[] = []
  for (const kind of sandboxOriginKinds) {
    if (manifest.sandbox?.[kind] !== undefined) {
      features.push({ path: `sandbox.${kind}`, since: '0.1.3' })
    }
  }
  for (const [index, module] of (manifest.contributes.modules ?? []).entries()) {
    if (module.layout !== undefined) {
      features.push({ path: `contributes.modules[${index}].layout`, since: '0.1.3' })
    }
  }
  if (manifest.connections !== undefined) {
    features.push({ path: 'connections', since: '0.1.6' })
  }
  if (manifest.settings !== undefined) {
    features.push({ path: 'settings', since: '0.1.9' })
  }
  return features
}

/** Unique keys, `enum` only where it applies, and defaults the setting accepts (ADR 0048). */
function checkSettingDeclarations (manifest: AppManifest): Finding[] {
  const findings: Finding[] = []
  const keys = new Set<string>()
  for (const [index, setting] of (manifest.settings ?? []).entries()) {
    const at = `${manifestFileName}#settings[${index}]`
    if (keys.has(setting.key)) {
      findings.push({ path: `${at}.key`, message: `duplicates the setting key ${JSON.stringify(setting.key)}` })
    }
    keys.add(setting.key)
    if (setting.enum !== undefined && setting.type !== 'string' && setting.type !== 'stringList') {
      findings.push({ path: `${at}.enum`, message: `applies to string and stringList settings only, not to ${setting.type}` })
    }
    if (setting.default !== undefined) {
      const problem = checkSettingValue(setting, setting.default)
      if (problem) {
        findings.push({ path: `${at}.default`, message: problem })
      }
    }
  }
  return findings
}

/** Where a setting's values are set: per installation, or also per infrastructure. */
export function settingScope (setting: Pick<AppSetting, 'scope'>): 'installation' | 'infrastructure' {
  return setting.scope ?? 'installation'
}

function isSettingString (value: unknown): value is string {
  return typeof value === 'string' && value.length <= appSettingLimits.stringLength
}

/**
 * Why a setting does not accept a value (ADR 0048), or `null` when it does.
 * Studio checks every value it stores with this, and `studio-app pack` the
 * defaults.
 */
export function checkSettingValue (setting: Pick<AppSetting, 'type' | 'enum'>, value: unknown): string | null {
  const allowed = setting.enum
  const inEnum = (item: string) => !allowed || allowed.includes(item)
  const oneOf = () => `must be one of ${allowed!.map(item => JSON.stringify(item)).join(', ')}`
  switch (setting.type) {
    case 'string': {
      if (!isSettingString(value)) {
        return `must be a string of at most ${appSettingLimits.stringLength} characters`
      }
      return inEnum(value) ? null : oneOf()
    }
    case 'number': {
      return typeof value === 'number' && Number.isFinite(value) ? null : 'must be a finite number'
    }
    case 'boolean': {
      return typeof value === 'boolean' ? null : 'must be true or false'
    }
    case 'stringList': {
      if (!Array.isArray(value) || value.length > appSettingLimits.listItems || !value.every(item => isSettingString(item))) {
        return `must be a list of at most ${appSettingLimits.listItems} strings of at most ${appSettingLimits.stringLength} characters`
      }
      return value.every(item => inEnum(item)) ? null : `items ${oneOf()}`
    }
    default: {
      return 'has a type this Studio does not know'
    }
  }
}

/**
 * Checks values for an app's settings: each key must be a declared setting
 * that accepts the value, and, set on an infrastructure, one of scope
 * `infrastructure`. `path` prefixes the findings, e.g. `values` or
 * `apps.0.settings`.
 */
export function checkSettingValues (manifest: Pick<AppManifest, 'id' | 'settings'>, values: Readonly<Record<string, unknown>>, options: { path: string, scope: 'installation' | 'infrastructure' }): Finding[] {
  const declared = new Map((manifest.settings ?? []).map(setting => [setting.key, setting]))
  const findings: Finding[] = []
  for (const [key, value] of Object.entries(values)) {
    const setting = declared.get(key)
    const path = `${options.path}.${key}`
    if (!setting) {
      findings.push({ path, message: `is not a setting of ${manifest.id}` })
      continue
    }
    if (options.scope === 'infrastructure' && settingScope(setting) !== 'infrastructure') {
      findings.push({ path, message: 'is set per installation, on the Apps page, not per infrastructure' })
      continue
    }
    const problem = checkSettingValue(setting, value)
    if (problem) {
      findings.push({ path, message: problem })
    }
  }
  return findings
}

/** The indexed and compiled OpenAPI document of an app connection (ADR 0047). */
export interface ConnectionApi {
  index: ApiIndex
  validators: Map<string, OperationValidators>
}

/**
 * Checks the OpenAPI documents of the manifest's connections (ADR 0047):
 * each parses, defines the listed operations once, refers only within
 * itself, uses parameters and bodies Studio can send, and has schemas that
 * compile. `read` gives a package file's text, or `undefined`. Returns the
 * findings, and per connection ID what Studio calls with.
 */
export function checkConnectionApis (manifest: AppManifest, read: (path: string) => string | undefined): { apis: Map<string, ConnectionApi>, findings: Finding[] } {
  const apis = new Map<string, ConnectionApi>()
  const findings: Finding[] = []
  for (const [index, connection] of (manifest.connections ?? []).entries()) {
    const text = read(connection.api)
    if (text === undefined) {
      continue
    }
    if (text.length > maxApiDocumentBytes) {
      findings.push({ path: connection.api, message: `is larger than ${maxApiDocumentBytes / 1024 / 1024} MiB` })
      continue
    }
    const indexed = indexApi(text, connection.operations, connection.api, `${manifestFileName}#connections[${index}].operations`)
    findings.push(...indexed.findings)
    if (!indexed.index) {
      continue
    }
    const compiled = compileApi(indexed.index, connection.api)
    findings.push(...compiled.findings)
    if (compiled.findings.length === 0) {
      apis.set(connection.id, { index: indexed.index, validators: compiled.validators })
    }
  }
  return { apis, findings }
}

/**
 * A manifest that uses a newer field must not claim to run on an app API
 * without it: an older Studio would refuse the unknown property with a less
 * helpful message (ADR 0045).
 */
function checkFeatureVersions (manifest: AppManifest): Finding[] {
  const lowest = semver.validRange(manifest.studioApi) ? semver.minVersion(manifest.studioApi) : null
  if (!lowest) {
    return []
  }
  return usedFeatures(manifest)
    .filter(feature => semver.lt(lowest, feature.since))
    .map(feature => ({ path: `${manifestFileName}#studioApi`, message: `allows Studio app API ${lowest.version}, but ${feature.path} needs ${feature.since}; declare ^${feature.since}` }))
}

/**
 * Loopback origins (`http://localhost`, …) are for development; hosted Studio
 * accepts them in developer mode only. IPv6 literals such as `[::1]` are not
 * origins a manifest may name: CSP ignores them as invalid sources.
 */
export function isLoopbackOrigin (origin: string): boolean {
  return /^http:\/\/(?:localhost|(?:[a-z0-9-]+\.)+localhost|127\.0\.0\.1)(?::\d+)?$/.test(origin)
}

/**
 * Whether a manifest origin entry (`https://*.example.org`, ADR 0045) covers
 * an origin, as a CSP host source does. The wildcard matches subdomains at
 * any depth, not the domain itself. An entry without a port means the
 * scheme's default port. An `http:` entry also covers `https:` on port 443,
 * if it has no port or port 80 (CSP's scheme and port upgrade; Chromium does
 * not upgrade other ports).
 */
export function originCovers (entry: string, origin: string): boolean {
  const match = /^(https?):\/\/(\*\.)?([^:]+)(?::(\d+))?$/.exec(entry)
  const target = URL.parse(origin)
  if (!match || !target) {
    return false
  }
  const [, scheme, wildcard, host, port] = match
  const defaultPort = (protocol: string) => protocol === 'https' ? '443' : '80'
  const targetScheme = target.protocol.slice(0, -1)
  const targetPort = target.port || defaultPort(targetScheme)
  let portMatches: boolean
  if (targetScheme === scheme) {
    portMatches = targetPort === (port ?? defaultPort(scheme))
  } else if (scheme === 'http' && targetScheme === 'https') {
    portMatches = targetPort === '443' && (port === undefined || port === '80')
  } else {
    return false
  }
  return portMatches && (wildcard ? target.hostname.endsWith(`.${host}`) : target.hostname === host)
}

/** The origins a manifest declares, per kind (ADR 0045). */
export function sandboxOrigins (manifest: AppManifest): Record<SandboxOriginKind, string[]> {
  return Object.fromEntries(sandboxOriginKinds.map(kind => [kind, [...(manifest.sandbox?.[kind] ?? [])]])) as Record<SandboxOriginKind, string[]>
}

/**
 * Whether the app could run code that is not in its package (ADR 0045):
 * WebAssembly compiled from, or a `blob:` worker started with, what it
 * fetched from a connect origin. Studio installs such apps only when they are
 * bundled or their publisher is granted `remoteCode` in the trust store.
 */
export function needsRemoteCodeGrant (manifest: AppManifest): boolean {
  const sandbox = manifest.sandbox ?? {}
  return (sandbox.connectOrigins?.length ?? 0) > 0 && Boolean(sandbox.webAssembly || sandbox.workers)
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
