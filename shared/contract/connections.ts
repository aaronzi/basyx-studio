import { connectionIdPattern, connectionIdRule } from '@basyx/studio-sdk/protocol'
import { z } from 'zod'
import { scopesSchema, secretInputSchema, secretSummarySchema } from './credentials'

// Connections of an infrastructure to services that are not AAS services
// (ADR 0040). `type` names the API the service speaks and selects the
// adapter in the Studio Service; `auth` says how Studio authenticates there.
// A connection never serves as a generic proxy.

/** What a connection can be used for; capabilities are named by purpose. */
export const connectionPurposes = ['timeseries'] as const
export type ConnectionPurpose = (typeof connectionPurposes)[number]

export const connectionAuthSchemes = ['none', 'token', 'bearer', 'header', 'basic', 'oauth2ClientCredentials', 'delegatedUser'] as const
export type ConnectionAuthScheme = (typeof connectionAuthSchemes)[number]

export interface ConnectionTypeInfo {
  purposes: readonly ConnectionPurpose[]
  /** The schemes the adapter accepts. */
  authSchemes: readonly ConnectionAuthScheme[]
  /** Used unless the connection sets `timeoutSeconds`. */
  defaultTimeoutSeconds: number
}

export const connectionTypes = {
  /** InfluxDB 2.x: Flux over `/api/v2/query`. */
  influxdb2: { purposes: ['timeseries'], authSchemes: ['token'], defaultTimeoutSeconds: 15 },
  /** A service that bound apps call through the operations they declare (ADR 0047). */
  http: { purposes: [], authSchemes: connectionAuthSchemes, defaultTimeoutSeconds: 30 },
} as const satisfies Record<string, ConnectionTypeInfo>
export type ConnectionType = keyof typeof connectionTypes
export const connectionTypeNames = Object.keys(connectionTypes) as [ConnectionType, ...ConnectionType[]]

/** The longest timeout a connection may set (MVP-7 plan, K7). */
export const maxConnectionTimeoutSeconds = 120

/** The secret field of each scheme, if it has one. */
export const connectionSecretFields = {
  none: null,
  token: 'token',
  bearer: 'token',
  header: 'value',
  basic: 'password',
  oauth2ClientCredentials: 'clientSecret',
  delegatedUser: null,
} as const satisfies Record<ConnectionAuthScheme, string | null>

/** Keys of connections and the `id`s of app connections share one rule, defined by the SDK. */
export const connectionKeySchema = z.string().regex(connectionIdPattern, `use ${connectionIdRule}`)

/** Headers Studio sets itself or that would change how the request is transported. */
const reservedHeaders = new Set(['host', 'content-length', 'content-type', 'accept', 'transfer-encoding', 'connection', 'keep-alive', 'upgrade', 'te', 'trailer', 'expect', 'proxy-authorization', 'proxy-connection'])

const headerNameSchema = z.string()
  .regex(/^[!#$%&'*+.^\w`|~-]{1,100}$/, 'must be an HTTP header name')
  .refine(name => !reservedHeaders.has(name.toLowerCase()), 'Studio sets this header itself')

/** A base URL without credentials, query or fragment. */
const serviceUrlSchema = z.url({ protocol: /^https?$/ }).max(2000).refine(value => {
  const url = new URL(value)
  return !url.username && !url.password && !url.search && !url.hash
}, 'must not contain credentials, a query or a fragment')

const audienceSchema = z.string().trim().min(1).max(500)
const issuerSchema = z.url({ protocol: /^https?$/ }).max(2000)

export const connectionAuthInputSchema = z.discriminatedUnion('scheme', [
  z.object({ scheme: z.literal('none') }),
  /** `Authorization: Token …`, e.g. InfluxDB API tokens. Omit the secret on update to keep it. */
  z.object({ scheme: z.literal('token'), token: secretInputSchema.optional() }),
  z.object({ scheme: z.literal('bearer'), token: secretInputSchema.optional() }),
  z.object({ scheme: z.literal('header'), name: headerNameSchema, value: secretInputSchema.optional() }),
  z.object({ scheme: z.literal('basic'), username: z.string().min(1).max(500).regex(/^[^:]*$/, 'must not contain a colon'), password: secretInputSchema.optional() }),
  z.object({
    scheme: z.literal('oauth2ClientCredentials'),
    issuer: issuerSchema,
    clientId: z.string().min(1).max(500),
    clientSecret: secretInputSchema.optional(),
    scopes: scopesSchema.default([]),
    /** Sent as `audience` in the token request, for issuers that need it. */
    audience: audienceSchema.optional(),
  }),
  z.object({
    scheme: z.literal('delegatedUser'),
    /** The service's audience; the token Studio sends must be issued for it. */
    audience: audienceSchema,
    scopes: scopesSchema.default([]),
    /** Forward the user's token unchanged instead of exchanging it (RFC 8693); only if its `aud` contains `audience`. */
    forwardUserToken: z.boolean().default(false),
  }),
])
export type ConnectionAuthInput = z.input<typeof connectionAuthInputSchema>

export const connectionAuthSummarySchema = z.discriminatedUnion('scheme', [
  z.object({ scheme: z.literal('none') }),
  z.object({ scheme: z.literal('token'), token: secretSummarySchema.nullable() }),
  z.object({ scheme: z.literal('bearer'), token: secretSummarySchema.nullable() }),
  z.object({ scheme: z.literal('header'), name: z.string(), value: secretSummarySchema.nullable() }),
  z.object({ scheme: z.literal('basic'), username: z.string(), password: secretSummarySchema.nullable() }),
  z.object({
    scheme: z.literal('oauth2ClientCredentials'),
    issuer: z.string(),
    clientId: z.string(),
    clientSecret: secretSummarySchema.nullable(),
    scopes: z.array(z.string()),
    audience: z.string().optional(),
  }),
  z.object({ scheme: z.literal('delegatedUser'), audience: z.string(), scopes: z.array(z.string()), forwardUserToken: z.boolean() }),
])
export type ConnectionAuthSummary = z.infer<typeof connectionAuthSummarySchema>

export const influxdb2SettingsSchema = z.object({
  /** Replaces the `org`/`orgID` of the endpoints named in AAS content. */
  organization: z.string().trim().min(1).max(200).optional(),
}).strict()

/** HTTP connections have no settings yet; the field keeps the shape of the type union. */
export const httpSettingsSchema = z.object({}).strict()

/**
 * An app connection bound to an `http` connection (ADR 0047): an app ID and
 * the `id` of a connection in its manifest. A refused `connection` names the
 * app, so a deployment's infrastructure file points at the binding to fix.
 */
export const connectionBindingSchema = z.object({
  app: z.string().max(128).regex(/^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*){1,9}$/, 'must be an app ID such as org.example.app'),
  connection: z.string(),
}).strict().superRefine((binding, context) => {
  if (!connectionIdPattern.test(binding.connection)) {
    context.addIssue({ code: 'custom', path: ['connection'], input: binding.connection, message: `app ${binding.app}, connection ${JSON.stringify(binding.connection)}: not an app connection ID; use ${connectionIdRule}` })
  }
})
export type ConnectionBinding = z.infer<typeof connectionBindingSchema>

/** The largest number of app connections bound to one connection. */
export const maxConnectionBindings = 50

const connectionFields = {
  key: connectionKeySchema,
  /** How the Studio Service reaches the service, e.g. `http://influxdb:8086`. */
  url: serviceUrlSchema,
  /** Other origins under which AAS content refers to the service, e.g. `http://localhost:8086`; never contacted. */
  aliases: z.array(serviceUrlSchema).max(10).default([]),
  /** Permit loopback and private-network addresses; subject to the deployment policy. */
  allowPrivateNetwork: z.boolean().default(false),
  /** Overrides the adapter's default timeout. */
  timeoutSeconds: z.number().int().min(1).max(maxConnectionTimeoutSeconds).optional(),
}

export const connectionInputSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('influxdb2'), ...connectionFields, auth: connectionAuthInputSchema, settings: influxdb2SettingsSchema.default({}) }),
  z.object({
    type: z.literal('http'),
    ...connectionFields,
    auth: connectionAuthInputSchema,
    settings: httpSettingsSchema.default({}),
    /** The app connections that may call this service, each with its declared operations. */
    apps: z.array(connectionBindingSchema).max(maxConnectionBindings).default([]),
  }),
]).superRefine((connection, context) => {
  const accepted: readonly ConnectionAuthScheme[] = connectionTypes[connection.type].authSchemes
  if (!accepted.includes(connection.auth.scheme)) {
    context.addIssue({ code: 'custom', path: ['auth', 'scheme'], message: `${connection.type} connections accept ${accepted.join(', ')}` })
  }
  if (connection.type === 'http' && connection.aliases.length > 0) {
    context.addIssue({ code: 'custom', path: ['aliases'], message: 'http connections are called by apps only; no content refers to them by an alias' })
  }
})
export type ConnectionInput = z.input<typeof connectionInputSchema>
export type ParsedConnectionInput = z.output<typeof connectionInputSchema>

/** A connection as stored and returned; secrets as summaries only. */
export const connectionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('influxdb2'),
    key: z.string(),
    url: z.string(),
    aliases: z.array(z.string()),
    allowPrivateNetwork: z.boolean(),
    timeoutSeconds: z.number().int().optional(),
    auth: connectionAuthSummarySchema,
    settings: influxdb2SettingsSchema,
  }),
  z.object({
    type: z.literal('http'),
    key: z.string(),
    url: z.string(),
    aliases: z.array(z.string()),
    allowPrivateNetwork: z.boolean(),
    timeoutSeconds: z.number().int().optional(),
    auth: connectionAuthSummarySchema,
    settings: httpSettingsSchema,
    apps: z.array(connectionBindingSchema),
  }),
])
export type Connection = z.infer<typeof connectionSchema>
export type HttpConnection = Extract<Connection, { type: 'http' }>

/** Checks of *Test connection* (CON-005), in the order they run. */
export const connectionChecks = ['token', 'health', 'query'] as const

export const connectionTestRequestSchema = z.object({
  /** An edited connection to test before saving; its omitted secret is the stored one of the same key. Without it, the stored connection is tested. */
  connection: z.unknown().optional(),
}).strict()

export const connectionTestResultSchema = z.object({
  checkedAt: z.string(),
  ok: z.boolean(),
  checks: z.array(z.object({
    check: z.enum(connectionChecks),
    ok: z.boolean(),
    status: z.number().int().nullable(),
    latencyMs: z.number().nullable(),
    /** What went wrong; never contains the secret. */
    message: z.string().nullable(),
  })),
})
export type ConnectionTestResult = z.infer<typeof connectionTestResultSchema>

// ---------------------------------------------------------------------------
// `studio.connections.call` (ADR 0047)

/** A path, query or header parameter value as the app passes it. */
const parameterValueSchema = z.union([z.string().max(10_000), z.number(), z.boolean()])

const parameterNames = z.string().min(1).max(200)

/**
 * The parameters of `studio.connections.call` in the HTTP binding
 * (`POST /app-calls`): bytes travel as base64, a request body as a string
 * with `encoding: 'base64'`, a multipart file as `{ fileName, contentType,
 * base64 }`. Studio's page and the backend harness convert the app's
 * `Uint8Array`s (`encodeConnectionCall`).
 */
/** A parameter value, or a list of them for array parameters (path, query and header). */
const parameterValuesSchema = z.union([parameterValueSchema, z.array(parameterValueSchema).max(1000)])

export const connectionCallParamsSchema = z.object({
  connection: connectionKeySchema,
  operation: z.string().min(1).max(200),
  path: z.record(parameterNames, parameterValuesSchema).optional(),
  query: z.record(parameterNames, parameterValuesSchema).optional(),
  headers: z.record(parameterNames, parameterValuesSchema).optional(),
  contentType: z.string().min(1).max(200).optional(),
  body: z.unknown().optional(),
  encoding: z.literal('base64').optional(),
}).strict()
export type ConnectionCallWireParams = z.infer<typeof connectionCallParamsSchema>

/** A multipart file in the HTTP binding. */
export const connectionWireFileSchema = z.object({
  fileName: z.string().min(1).max(500),
  contentType: z.string().min(1).max(200).optional(),
  base64: z.string(),
}).strict()

/** A form or multipart body in the HTTP binding. */
export const connectionWireFormSchema = z.object({
  fields: z.record(parameterNames, z.string()).optional(),
  files: z.record(parameterNames, connectionWireFileSchema).optional(),
}).strict()

/** The result in the HTTP binding: a binary body is base64 with `encoding: 'base64'`. */
export interface ConnectionCallWireResult {
  status: number
  contentType: string | null
  etag: string | null
  location: string | null
  body: unknown
  encoding?: 'base64'
}

function base64Of (bytes: Uint8Array): string {
  let text = ''
  for (let index = 0; index < bytes.length; index += 0x80_00) {
    text += String.fromCodePoint(...bytes.subarray(index, index + 0x80_00))
  }
  return btoa(text)
}

function bytesOf (base64: string): Uint8Array {
  const text = atob(base64)
  const bytes = new Uint8Array(text.length)
  for (let index = 0; index < text.length; index++) {
    bytes[index] = text.codePointAt(index)!
  }
  return bytes
}

function binary (value: unknown): Uint8Array | null {
  if (value instanceof Uint8Array) {
    return value
  }
  return value instanceof ArrayBuffer ? new Uint8Array(value) : null
}

function isRecord (value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** The bytes of a multipart file part as the app passes it (`{ fileName, bytes }`), if it is one. */
function fileBytes (file: unknown): Uint8Array | null {
  return isRecord(file) ? binary(file.bytes) : null
}

/**
 * The app's call parameters in the HTTP binding: a `Uint8Array` body and
 * the bytes of multipart file parts as base64. Anything else, also a JSON
 * body with a `files` property, passes unchanged.
 */
export function encodeConnectionCall (params: unknown): unknown {
  if (!isRecord(params)) {
    return params
  }
  const { body, ...rest } = params
  const bytes = binary(body)
  if (bytes) {
    return { ...rest, body: base64Of(bytes), encoding: 'base64' }
  }
  const files = isRecord(body) && isRecord(body.files) ? body.files : null
  if (!files || !Object.values(files).some(file => fileBytes(file))) {
    return params
  }
  const encoded = Object.fromEntries(Object.entries(files).map(([name, file]) => {
    const content = fileBytes(file)
    if (!content) {
      return [name, file]
    }
    const { bytes: _bytes, ...part } = file as Record<string, unknown>
    return [name, { ...part, base64: base64Of(content) }]
  }))
  return { ...rest, body: { ...body as Record<string, unknown>, files: encoded } }
}

/** A result of the HTTP binding as the app receives it: a base64 body as `Uint8Array`. */
export function decodeConnectionResult (result: ConnectionCallWireResult): { result: Omit<ConnectionCallWireResult, 'encoding'>, transfer: ArrayBuffer[] } {
  const { encoding, ...rest } = result
  if (encoding === 'base64' && typeof rest.body === 'string') {
    const bytes = bytesOf(rest.body)
    return { result: { ...rest, body: bytes }, transfer: [bytes.buffer as ArrayBuffer] }
  }
  return { result: rest, transfer: [] }
}
