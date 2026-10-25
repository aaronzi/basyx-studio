import type { CopyPlan, CopyPlanRequest, CopyResourceType } from '#shared/contract'
import { defineStore } from 'pinia'

/** An element copied in Studio: plain AAS JSON, so it pastes across submodels, shells and targets (MVP-5 plan, C1). */
export interface CopiedElement {
  element: Record<string, unknown>
  /** Where it came from, for the paste menu. */
  label: string
}

/**
 * A shell, submodel or concept description copied in Studio (package
 * editing plan, K1): where it is, not its content, which a paste reads
 * then, with its submodels, concept descriptions and files.
 */
export interface CopiedResource {
  type: CopyResourceType
  targetId: string
  key: string
  label: string
}

/** A paste or import waiting for the copy plan dialog: a plan to make, or one made already (an uploaded file). */
export interface PendingCopy {
  request: CopyPlanRequest | null
  plan: CopyPlan | null
  title: string
}

export const useClipboardStore = defineStore('clipboard', () => {
  /** One entry at a time, as on the system clipboard: an element or a resource. */
  const copied = ref<CopiedElement | null>(null)
  const resource = ref<CopiedResource | null>(null)
  /** A model reference to a node (*Copy reference*, C2) for reference fields. */
  const copiedReference = ref<{ type: string, keys: Array<{ type: string, value: string }> } | null>(null)
  const pending = shallowRef<PendingCopy | null>(null)
  /** The copy plan dialog waits for the server; nothing else opens it meanwhile. */
  const busy = ref(false)

  function copy (value: CopiedElement): void {
    copied.value = value
    resource.value = null
  }

  function copyResource (value: CopiedResource): void {
    resource.value = value
    copied.value = null
  }

  function copyReference (reference: { type: string, keys: Array<{ type: string, value: string }> }): void {
    copiedReference.value = reference
  }

  function clear (): void {
    copied.value = null
    resource.value = null
  }

  /** Opens the copy plan dialog (CopyPlanDialog in the layout). */
  function openCopy (value: PendingCopy): void {
    if (!busy.value) {
      pending.value = value
    }
  }

  return { copied, resource, copiedReference, pending, busy, copy, copyResource, copyReference, clear, openCopy }
})
