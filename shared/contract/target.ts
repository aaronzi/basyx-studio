import { z } from 'zod'
import { securityModeSchema } from './infrastructure'

export const authenticationStates = ['not_required', 'authenticated', 'required'] as const
export const authenticationStateSchema = z.enum(authenticationStates)
export type AuthenticationState = z.infer<typeof authenticationStateSchema>

export const targetKinds = ['live', 'workspace'] as const
export type TargetKind = (typeof targetKinds)[number]

/**
 * What a target supports. Feature code branches on capabilities, never on
 * the target kind.
 * - `persistence: immediate` writes reach the source on apply (live targets);
 *   `explicit_save` keeps applied changes until the user saves (workspaces).
 */
export const targetCapabilitiesSchema = z.object({
  write: z.boolean(),
  persistence: z.enum(['immediate', 'explicit_save']),
})
export type TargetCapabilities = z.infer<typeof targetCapabilitiesSchema>

/** State of a desktop AASX workspace; `null` for live targets. */
export const workspaceStateSchema = z.object({
  fileName: z.string(),
  unsavedChanges: z.boolean(),
})
export type WorkspaceState = z.infer<typeof workspaceStateSchema>

export const targetSchema = z.object({
  id: z.string(),
  kind: z.enum(targetKinds),
  name: z.string(),
  description: z.string().nullable(),
  /** Downstream security mode of a live target; `null` for workspaces. */
  securityMode: securityModeSchema.nullable(),
  authenticationState: authenticationStateSchema,
  capabilities: targetCapabilitiesSchema,
  workspace: workspaceStateSchema.nullable(),
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

/**
 * How reliably a write detects concurrent changes:
 * - `strong`: the source checks the revision atomically (HTTP `If-Match`);
 * - `best_effort`: Studio compares against a fresh read just before writing,
 *   so a change between that read and the write is not detected.
 */
export const concurrencyModes = ['strong', 'best_effort'] as const
export type ConcurrencyMode = (typeof concurrencyModes)[number]

/** Value kinds the editor can change. */
export const editableModelTypes = ['Property', 'MultiLanguageProperty'] as const
export type EditableModelType = (typeof editableModelTypes)[number]

export const elementDetailSchema = z.object({
  key: z.string(),
  /** Human-readable path, e.g. `Level1.Items[2]` or `Calibrate@input.Offset`. */
  path: z.string(),
  value: z.unknown(),
  /**
   * Opaque revision token for writes (sent back as `If-Match`), or `null`
   * when the element cannot be written, e.g. an operation variable.
   */
  revision: z.string().nullable(),
  concurrency: z.enum(concurrencyModes).nullable(),
})
export type ElementDetail = z.infer<typeof elementDetailSchema>

/**
 * New value of a `Property` (a string, or `null` to clear it) or of a
 * `MultiLanguageProperty` (all language strings).
 */
export const elementValueInputSchema = z.object({
  value: z.union([
    z.string().max(1_000_000).nullable(),
    z.array(langStringSchema.extend({
      language: z.string().min(1).max(64),
      text: z.string().max(1_000_000),
    })).max(200),
  ]),
})
export type ElementValueInput = z.infer<typeof elementValueInputSchema>

export const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().max(4000).optional(),
})
