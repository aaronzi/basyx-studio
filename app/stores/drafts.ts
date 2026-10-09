import type { ElementValueInput } from '#shared/contract'
import { defineStore } from 'pinia'

/** An unapplied value change and the revision it is based on. */
export interface ElementDraft {
  revision: string
  value: ElementValueInput['value']
}

/**
 * Editor drafts per target, submodel and element (ADR 0006). They stay here
 * until applied or discarded, so a failed apply or a navigation never loses
 * the user's input. Drafts are never mixed with cached target data.
 */
export const useDraftStore = defineStore('drafts', () => {
  const drafts = ref<Record<string, ElementDraft>>({})

  function keyOf (targetId: string, submodelKey: string, elementKey: string): string {
    return JSON.stringify([targetId, submodelKey, elementKey])
  }

  function get (targetId: string, submodelKey: string, elementKey: string): ElementDraft | undefined {
    return drafts.value[keyOf(targetId, submodelKey, elementKey)]
  }

  function set (targetId: string, submodelKey: string, elementKey: string, draft: ElementDraft): void {
    drafts.value = { ...drafts.value, [keyOf(targetId, submodelKey, elementKey)]: draft }
  }

  function discard (targetId: string, submodelKey: string, elementKey: string): void {
    const { [keyOf(targetId, submodelKey, elementKey)]: _, ...rest } = drafts.value
    drafts.value = rest
  }

  function countFor (targetId: string): number {
    return Object.keys(drafts.value).filter(key => (JSON.parse(key) as string[])[0] === targetId).length
  }

  /** Drops every draft of a target, e.g. when its workspace is closed. */
  function discardTarget (targetId: string): void {
    drafts.value = Object.fromEntries(Object.entries(drafts.value).filter(([key]) => (JSON.parse(key) as string[])[0] !== targetId))
  }

  return { drafts, get, set, discard, countFor, discardTarget }
})
