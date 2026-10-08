import type { ConcurrencyMode, ElementValueInput, Page, ShellSummary, TargetCapabilities } from '#shared/contract'
import type { JsonObject } from '../aas/outline'

/** An element as read, with the revision token a write must be based on. */
export interface ElementSnapshot {
  value: JsonObject
  revision: string
  concurrency: ConcurrencyMode
}

/**
 * The AAS operations the Studio API needs, independent of where the data
 * lives (ADR 0003). Implemented by live infrastructures and desktop AASX
 * workspaces; route handlers only see this interface.
 */
export interface AasTarget {
  readonly capabilities: TargetCapabilities

  listShells: (limit: number, cursor: string | undefined) => Promise<Page<ShellSummary>>
  shell: (id: string) => Promise<JsonObject>
  /** Submodel identifiers referenced by a shell. */
  submodelIds: (shellId: string) => Promise<string[]>
  /** The submodel without its elements. */
  submodelMetadata: (id: string) => Promise<JsonObject>
  submodel: (id: string) => Promise<JsonObject>
  element: (submodelId: string, idShortPath: string) => Promise<ElementSnapshot>
  /**
   * Sets the value of a `Property` or `MultiLanguageProperty`. Fails with
   * `revision_conflict` when the element changed since `revision` was read.
   */
  setElementValue: (submodelId: string, idShortPath: string, value: ElementValueInput['value'], revision: string) => Promise<ElementSnapshot>
}
