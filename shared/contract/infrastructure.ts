import { z } from 'zod'

export const endpointTypes = ['aasRepository', 'submodelRepository', 'conceptDescriptionRepository'] as const
export const endpointTypeSchema = z.enum(endpointTypes)
export type EndpointType = z.infer<typeof endpointTypeSchema>

export const securityModes = ['unsecured', 'deployment_client_credentials', 'delegated_user'] as const
export const securityModeSchema = z.enum(securityModes)
export type SecurityMode = z.infer<typeof securityModeSchema>

const scopesSchema = z.array(z.string().regex(/^[\u0021\u0023-\u005B\u005D-\u007E]+$/, 'invalid scope')).max(20)

/**
 * A client secret is either a reference to deployment-provided secret material
 * (`env:NAME`, `file:/path`; hosted) or a value that the desktop Studio stores
 * encrypted with a key held in the OS credential store.
 */
export const secretInputSchema = z.union([
  z.object({ ref: z.string().regex(/^(?:env:[A-Z_][A-Z0-9_]*|file:\/\S+)$/, 'use env:NAME or file:/absolute/path') }),
  z.object({ value: z.string().min(1).max(4096) }),
])
export type SecretInput = z.infer<typeof secretInputSchema>

export const secretSummarySchema = z.object({
  kind: z.enum(['env', 'file', 'stored']),
  /** The reference for env/file secrets; never the secret value. */
  ref: z.string().nullable(),
})

const oidcFields = {
  issuer: z.url({ protocol: /^https?$/ }).max(2000),
  clientId: z.string().min(1).max(500),
  scopes: scopesSchema,
}

export const securityInputSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('unsecured') }),
  z.object({
    mode: z.literal('deployment_client_credentials'),
    ...oidcFields,
    /** Omit on update to keep the stored secret. */
    clientSecret: secretInputSchema.optional(),
  }),
  z.object({
    mode: z.literal('delegated_user'),
    ...oidcFields,
    /** Confidential hosted clients only; desktop clients are public (RFC 8252). */
    clientSecret: secretInputSchema.optional(),
    /** Loopback host registered at the IdP for the desktop client. */
    desktopLoopbackHost: z.enum(['127.0.0.1', 'localhost']).default('127.0.0.1'),
  }),
])
export type SecurityInput = z.infer<typeof securityInputSchema>

export const securitySummarySchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('unsecured') }),
  z.object({
    mode: z.literal('deployment_client_credentials'),
    ...oidcFields,
    clientSecret: secretSummarySchema.nullable(),
  }),
  z.object({
    mode: z.literal('delegated_user'),
    ...oidcFields,
    clientSecret: secretSummarySchema.nullable(),
    desktopLoopbackHost: z.enum(['127.0.0.1', 'localhost']),
  }),
])
export type SecuritySummary = z.infer<typeof securitySummarySchema>

export const endpointInputSchema = z.object({
  type: endpointTypeSchema,
  url: z.url({ protocol: /^https?$/ }).max(2000),
})
export type EndpointInput = z.infer<typeof endpointInputSchema>

export const infrastructureInputSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional(),
  endpoints: z
    .array(endpointInputSchema)
    .min(1)
    .max(endpointTypes.length)
    .refine(endpoints => new Set(endpoints.map(endpoint => endpoint.type)).size === endpoints.length, 'each endpoint type may occur only once')
    .refine(endpoints => endpoints.some(endpoint => endpoint.type === 'aasRepository'), 'an AAS repository endpoint is required')
    .refine(endpoints => endpoints.some(endpoint => endpoint.type === 'submodelRepository'), 'a submodel repository endpoint is required'),
  security: securityInputSchema,
  /** Permit loopback and private-network addresses; subject to the deployment policy. */
  allowPrivateNetwork: z.boolean().default(false),
})
export type InfrastructureInput = z.input<typeof infrastructureInputSchema>

export const infrastructureSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  endpoints: z.array(endpointInputSchema),
  security: securitySummarySchema,
  allowPrivateNetwork: z.boolean(),
  revision: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
})
export type Infrastructure = z.infer<typeof infrastructureSchema>

export const probeResultSchema = z.object({
  checkedAt: z.string(),
  endpoints: z.array(z.object({
    type: endpointTypeSchema,
    reachable: z.boolean(),
    status: z.number().int().nullable(),
    latencyMs: z.number().nullable(),
    error: z.string().nullable(),
  })),
})
export type ProbeResult = z.infer<typeof probeResultSchema>
