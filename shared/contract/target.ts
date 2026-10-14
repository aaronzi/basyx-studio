import { z } from 'zod'
import { securityModeSchema } from './infrastructure'

export const authenticationStates = ['not_required', 'authenticated', 'required'] as const
export const authenticationStateSchema = z.enum(authenticationStates)
export type AuthenticationState = z.infer<typeof authenticationStateSchema>

export const targetKinds = ['live', 'workspace'] as const
export type TargetKind = (typeof targetKinds)[number]

export const searchScopes = ['none', 'shells', 'elements'] as const

/**
 * What a target supports. Feature code branches on capabilities, never on
 * the target kind.
 * - `persistence: immediate` writes reach the source on apply (live targets);
 *   `explicit_save` keeps applied changes until the user saves (workspaces).
 * - `search`: `shells` matches shell fields, `elements` also submodel elements.
 * - `history`, `changeFeed` and `sharing` are optional BaSyx Go features that
 *   Studio detects on the target; they are `false` until detected.
 */
export const targetCapabilitiesSchema = z.object({
  write: z.boolean(),
  persistence: z.enum(['immediate', 'explicit_save']),
  deleteShells: z.boolean(),
  /** Read File elements and thumbnails, and replace File contents. */
  files: z.boolean(),
  operations: z.boolean(),
  conceptDescriptions: z.boolean(),
  search: z.enum(searchScopes),
  /** Find shells by asset ID. */
  discovery: z.boolean(),
  /** Download a shell with its submodels as AASX, JSON or XML. */
  export: z.boolean(),
  /** Add the content of an AASX, JSON or XML file. */
  upload: z.boolean(),
  /** Read submodels and shells as they were at a point in time. */
  history: z.boolean(),
  /** Read the change events of shells, submodels and assets. */
  changeFeed: z.boolean(),
  /** Grant other users access to a shell (BaSyx Go ReBAC, as the signed-in user). */
  sharing: z.boolean(),
})
export type TargetCapabilities = z.infer<typeof targetCapabilitiesSchema>

/** Nothing is offered; used while a target is unknown or not loaded. */
export const noCapabilities: TargetCapabilities = {
  write: false,
  persistence: 'immediate',
  deleteShells: false,
  files: false,
  operations: false,
  conceptDescriptions: false,
  search: 'none',
  discovery: false,
  export: false,
  upload: false,
  history: false,
  changeFeed: false,
  sharing: false,
}

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
  /** Whether the asset information names a default thumbnail. */
  thumbnail: z.boolean(),
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

/** A node of a fully loaded submodel tree, with its children. */
export interface TreeNode extends ElementNode {
  /** Value type of a Property or Range (`xs:double`, …). */
  valueType: string | null
  children?: TreeNode[]
}

/**
 * A submodel with all its elements, for client-side filtering and
 * auto-refresh. `truncated` means the submodel exceeded Studio's size cap and
 * `root` holds only the top level; the UI then loads levels on demand.
 */
export interface SubmodelTree {
  key: string
  submodelId: string
  idShort: string | null
  semanticId: string | null
  truncated: boolean
  root: TreeNode[]
}

export const submodelTreeQuerySchema = z.object({
  /** Point in time (ISO 8601) for a historic version; needs the `history` capability. */
  at: z.iso.datetime({ offset: true }).optional(),
})

export const conceptDescriptionSummarySchema = z.object({
  id: z.string(),
  idShort: z.string().nullable(),
  preferredName: z.array(langStringSchema),
  definition: z.array(langStringSchema),
  dataType: z.string().nullable(),
  unit: z.string().nullable(),
})
export type ConceptDescriptionSummary = z.infer<typeof conceptDescriptionSummarySchema>

export const searchQuerySchema = z.object({
  q: z.string().trim().min(2).max(200),
  limit: z.coerce.number().int().min(1).max(20).default(6),
})

/** A submodel element that matched a search, with where to find it. */
export interface ElementHit {
  shellKey: string | null
  shellLabel: string | null
  submodelKey: string
  submodelLabel: string
  elementKey: string
  label: string
  modelType: string
  path: string
}

export interface SearchResult {
  shells: ShellSummary[]
  elements: ElementHit[]
}

export const lookupQuerySchema = z.object({
  assetId: z.string().trim().min(1).max(2000),
})

export const exportFormats = ['aasx', 'json', 'xml'] as const
export type ExportFormat = (typeof exportFormats)[number]
export const exportQuerySchema = z.object({ format: z.enum(exportFormats) })

/** Result of an upload: the shells it added. */
export interface UploadResult {
  shells: ShellSummary[]
}

export const operationArgumentSchema = z.object({
  idShort: z.string().min(1).max(128),
  value: z.string().max(100_000).nullable(),
})

export const invocationInputSchema = z.object({
  /** Values of the input and in-out variables, as typed by the user. */
  arguments: z.array(operationArgumentSchema).max(100),
  async: z.boolean().default(false),
})
export type InvocationInput = z.infer<typeof invocationInputSchema>

export interface OperationArgument {
  idShort: string
  valueType: string | null
  value: unknown
}

export interface Invocation {
  /** Handle of an asynchronous invocation, to poll its state. */
  handle: string | null
  state: 'running' | 'completed' | 'failed'
  outputs: OperationArgument[]
  message: string | null
}

export const changeActions = ['created', 'updated', 'deleted'] as const
export const changeEntities = ['aas', 'submodel', 'asset'] as const

export interface ChangeEvent {
  id: string
  time: string
  action: (typeof changeActions)[number]
  entity: (typeof changeEntities)[number]
  /** The AAS or submodel identifier. */
  subject: string
  /** The resource key of the subject, to link to it. */
  subjectKey: string
}

export interface ChangePage {
  items: ChangeEvent[]
  /** Pass as `after` to read newer events. */
  lastEventId: string | null
}

export const changesQuerySchema = z.object({
  /** Only events newer than this event. */
  after: z.string().max(200).optional(),
  /** ISO 8601; ignored with `after`. */
  since: z.iso.datetime({ offset: true }).optional(),
  /** Only events about these identifiers (a shell and its submodels). */
  subjects: z.union([z.string().max(2000), z.array(z.string().max(2000)).max(200)]).optional().transform(value => value === undefined ? undefined : (Array.isArray(value) ? value : [value])),
  limit: z.coerce.number().int().min(1).max(200).default(50),
})

/** Relations the share dialog offers; the target defines which it accepts. */
export const accessRelations = ['viewer', 'editor', 'executor', 'owner'] as const
const relationSchema = z.string().regex(/^[a-z][\w-]{0,63}$/, 'invalid relation')
export const accessGrantSchema = z.object({
  relation: relationSchema,
  subjectType: z.enum(['user', 'group']),
  issuer: z.string().min(1).max(2000),
  subject: z.string().min(1).max(500),
})
export type AccessGrant = z.infer<typeof accessGrantSchema>

export const accessGrantsInputSchema = z.object({ grants: z.array(accessGrantSchema).max(500) })

export interface AccessDocument {
  grants: AccessGrant[]
  /** Opaque revision; send it back as `If-Match` when replacing the grants. */
  revision: string | null
  /** Issuer of the signed-in user, for new grants. */
  issuer: string | null
}

export const rightActions = ['read', 'update', 'delete', 'execute', 'manage'] as const
export type RightAction = (typeof rightActions)[number]
/** The signed-in user's rights on a shell; every action is `true` without sharing. */
export type EffectiveRights = Record<RightAction, boolean>

export const invitationInputSchema = z.object({
  relation: relationSchema,
  expiresInDays: z.number().int().min(1).max(90).default(7),
  maxUses: z.number().int().min(1).max(100).default(1),
})

export interface InvitationResult {
  token: string
  expiresAt: string
}
