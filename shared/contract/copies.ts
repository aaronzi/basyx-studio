import type { SyncStep } from './target'
import { z } from 'zod'

// Copies of shells, submodels and concept descriptions between targets, and
// from pasted text or an imported file (DATA-012 to DATA-015; package editing
// plan, K3 to K8): a plan first, then its execution with a collision policy.

const keySchema = z.string().regex(/^[\w-]{1,4000}$/)

export const copyResourceTypes = ['shell', 'submodel', 'conceptDescription'] as const
export type CopyResourceType = (typeof copyResourceTypes)[number]

/**
 * What to do with resources whose identifier exists at the destination:
 * refuse before writing (the default), skip them, replace them, or give the
 * copied shells and submodels new identifiers (K5).
 */
export const collisionPolicies = ['fail_without_changes', 'skip_existing', 'replace', 'new_identifiers'] as const
export type CollisionPolicy = (typeof collisionPolicies)[number]

export const copySourceSchema = z.discriminatedUnion('kind', [
  /** Resources of a target, read when the plan is made and again when it runs. */
  z.object({
    kind: z.literal('target'),
    targetId: z.string().min(1).max(200),
    resources: z.array(z.object({ type: z.enum(copyResourceTypes), key: keySchema })).min(1).max(100),
  }),
  /** AAS JSON or XML from the system clipboard: an environment, a shell, a submodel or a concept description. */
  z.object({
    kind: z.literal('text'),
    format: z.enum(['json', 'xml']),
    content: z.string().min(1).max(20_000_000),
  }),
])
export type CopySource = z.infer<typeof copySourceSchema>

export const copyDependenciesSchema = z.object({
  /** A shell's submodels. */
  submodels: z.enum(['none', 'referenced']).default('referenced'),
  /** The concept descriptions the copied semantic IDs name, where the source has them. */
  conceptDescriptions: z.enum(['none', 'referenced']).default('referenced'),
  /** Files of File elements and thumbnails inside the source. */
  supplementaryFiles: z.enum(['none', 'referenced']).default('referenced'),
})
export type CopyDependencies = z.infer<typeof copyDependenciesSchema>

export const copyPlanRequestSchema = z.object({
  source: copySourceSchema,
  destinationTargetId: z.string().min(1).max(200),
  /** A copied submodel is also referenced from this shell of the destination. */
  destinationShellKey: keySchema.optional(),
  dependencies: copyDependenciesSchema.default({ submodels: 'referenced', conceptDescriptions: 'referenced', supplementaryFiles: 'referenced' }),
})
export type CopyPlanRequest = z.infer<typeof copyPlanRequestSchema>

/** Where a file to import goes; the file is the request body. */
export const copyUploadQuerySchema = z.object({
  destinationTargetId: z.string().min(1).max(200),
  fileName: z.string().min(1).max(255),
})

/** One resource the plan would write. */
export interface CopyResourcePlan {
  /** Opaque within the plan, for excluding the resource from the execution. */
  key: string
  resourceType: CopyResourceType
  identifier: string
  label: string
  /** The resource the user chose, or `dependency` of one. */
  role: 'root' | 'dependency'
  /** The identifier of the shell a dependency submodel belongs to. */
  shellIdentifier: string | null
  /** The identifier exists at the destination. */
  exists: boolean
  /** Why it cannot be copied, e.g. unreadable or invalid; it is left out. */
  blocked: string | null
  /** Files inside the source that go with it. */
  files: number
  /** AAS Core findings, which block the resource. */
  findings: string[]
}

export interface CopyPlan {
  id: string
  sourceTargetId: string | null
  /** The file or text the copy reads, for the dialog's title. */
  sourceLabel: string
  destinationTargetId: string
  destinationShellKey: string | null
  /** Source and destination are the same target: shells and submodels need new identifiers. */
  sameTarget: boolean
  resources: CopyResourcePlan[]
  allowedCollisionPolicies: CollisionPolicy[]
  /** The policy the dialog preselects. */
  defaultCollisionPolicy: CollisionPolicy
  /** Notes on the whole copy, e.g. that the destination keeps no concept descriptions. */
  notes: string[]
  expiresAt: string
}

export const copyExecutionSchema = z.object({
  collisionPolicy: z.enum(collisionPolicies),
  /** The user saw the plan, the policy and that the copy is not atomic. */
  confirmed: z.literal(true),
  /** Keys of resources the user deselected. */
  exclude: z.array(z.string().max(100)).max(10_000).default([]),
})
export type CopyExecution = z.infer<typeof copyExecutionSchema>

export interface CopyResourceOutcome {
  resourceType: CopyResourceType
  identifier: string
  /** The identifier at the destination: a new one under `new_identifiers`. */
  destinationIdentifier: string
  status: 'created' | 'replaced' | 'skipped' | 'failed'
  message: string | null
}

export interface CopyReport {
  planId: string
  status: 'succeeded' | 'partial_success' | 'failed'
  collisionPolicy: CollisionPolicy
  sourceUnchanged: true
  atomic: false
  counts: { planned: number, created: number, replaced: number, skipped: number, failed: number }
  outcomes: CopyResourceOutcome[]
  /** Descriptors and asset links Studio wrote at the destination. */
  sync: SyncStep[]
  /** The first copied shell at the destination, for opening it. */
  shellKey: string | null
  /** The first copied submodel at the destination, for opening it. */
  submodelKey: string | null
}
