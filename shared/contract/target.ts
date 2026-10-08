import { z } from 'zod'
import { securityModeSchema } from './infrastructure'

export const authenticationStates = ['not_required', 'authenticated', 'required'] as const
export const authenticationStateSchema = z.enum(authenticationStates)
export type AuthenticationState = z.infer<typeof authenticationStateSchema>

export const targetSchema = z.object({
  id: z.string(),
  kind: z.literal('live'),
  name: z.string(),
  description: z.string().nullable(),
  securityMode: securityModeSchema,
  authenticationState: authenticationStateSchema,
})
export type Target = z.infer<typeof targetSchema>

export function pageSchema<T extends z.ZodType> (item: T) {
  return z.object({
    items: z.array(item),
    page: z.object({
      nextCursor: z.string().nullable(),
      hasMore: z.boolean(),
    }),
  })
}
export interface Page<T> {
  items: T[]
  page: { nextCursor: string | null, hasMore: boolean }
}

export const langStringSchema = z.object({ language: z.string(), text: z.string() })
export type LangString = z.infer<typeof langStringSchema>

export const shellSummarySchema = z.object({
  key: z.string(),
  id: z.string(),
  idShort: z.string().nullable(),
  displayName: z.array(langStringSchema),
  description: z.array(langStringSchema),
  assetKind: z.string().nullable(),
  globalAssetId: z.string().nullable(),
})
export type ShellSummary = z.infer<typeof shellSummarySchema>

export const shellDetailSchema = z.object({
  key: z.string(),
  shell: z.record(z.string(), z.unknown()),
})
export type ShellDetail = z.infer<typeof shellDetailSchema>

export const submodelRefStatuses = ['available', 'forbidden', 'not_found', 'error'] as const
export const submodelRefSchema = z.object({
  key: z.string(),
  submodelId: z.string(),
  idShort: z.string().nullable(),
  semanticId: z.string().nullable(),
  status: z.enum(submodelRefStatuses),
})
export type SubmodelRef = z.infer<typeof submodelRefSchema>

export const operationVariableGroups = ['input', 'output', 'inoutput'] as const
export type OperationVariableGroup = (typeof operationVariableGroups)[number]

export const elementNodeSchema = z.object({
  key: z.string(),
  /** idShort, `[index]` for list items, or the variable group name. */
  label: z.string(),
  /** AAS modelType, or `OperationVariables` for a synthetic variable group. */
  modelType: z.string(),
  variableGroup: z.enum(operationVariableGroups).nullable(),
  semanticId: z.string().nullable(),
  preview: z.string().nullable(),
  hasChildren: z.boolean(),
})
export type ElementNode = z.infer<typeof elementNodeSchema>

export const submodelDetailSchema = z.object({
  key: z.string(),
  submodel: z.record(z.string(), z.unknown()),
})
export type SubmodelDetail = z.infer<typeof submodelDetailSchema>

export const elementDetailSchema = z.object({
  key: z.string(),
  /** Human-readable path, e.g. `Level1.Items[2]` or `Calibrate@input.Offset`. */
  path: z.string(),
  value: z.unknown(),
})
export type ElementDetail = z.infer<typeof elementDetailSchema>

export const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().max(4000).optional(),
})
