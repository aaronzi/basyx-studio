import type { ElementValueInput, Page, ShellSummary } from '#shared/contract'
import type { JsonObject } from '../aas/outline'
import type { Violation } from '../problem'
import type { ElementSnapshot } from '../targets/aas-target'

// IPC contract between the Studio Service and the Workspace Worker process.

export interface WorkspaceInfo {
  workspaceId: string
  fileName: string
  unsavedChanges: boolean
  /** AAS Core findings in the package as opened. */
  diagnostics: string[]
}

/** Target operations the worker executes on an opened workspace. */
export interface WorkspaceCalls {
  listShells: (limit: number, cursor: string | undefined) => Page<ShellSummary>
  shell: (id: string) => JsonObject
  submodelIds: (shellId: string) => string[]
  submodelMetadata: (id: string) => JsonObject
  submodel: (id: string) => JsonObject
  element: (submodelId: string, idShortPath: string) => ElementSnapshot
  setElementValue: (submodelId: string, idShortPath: string, value: ElementValueInput['value'], revision: string) => ElementSnapshot
}
export type WorkspaceMethod = keyof WorkspaceCalls

export type WorkerRequest
  = | { op: 'open', path: string }
    | { op: 'call', workspaceId: string, method: WorkspaceMethod, args: unknown[] }
    /** Saves in place, or to `path`, which then becomes the workspace's file (Save As). */
    | { op: 'save', workspaceId: string, path?: string }
    | { op: 'close', workspaceId: string }
    | { op: 'list' }

export interface WorkerResults {
  open: WorkspaceInfo
  call: unknown
  save: WorkspaceInfo
  close: null
  list: WorkspaceInfo[]
}

export interface WorkerProblem {
  code: string
  detail?: string
  violations?: Violation[]
}

export type WorkerResponse
  = | { id: number, ok: true, result: unknown }
    | { id: number, ok: false, problem: WorkerProblem }
