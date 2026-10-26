import type { FileDraftStore } from '@basyx/file-viewer/vue'
import { defineStore } from 'pinia'

/** The draft key of a File's or Blob's text (as the element drafts' key). */
export function fileDraftKey (targetId: string, submodelKey: string, elementKey: string): string {
  return JSON.stringify([targetId, submodelKey, elementKey])
}

/**
 * Unsaved texts of File and Blob elements in the file viewer (ADR 0052), with
 * the revision they are based on. As editor drafts (drafts.ts), they stay
 * until saved or discarded, so switching elements or views loses nothing.
 */
export const useFileDraftStore = defineStore('fileDrafts', () => {
  const drafts = ref<Record<string, { version: string, text: string }>>({})

  const store: FileDraftStore = {
    get: key => drafts.value[key],
    set: (key, draft) => {
      const { [key]: _, ...rest } = drafts.value
      drafts.value = draft ? { ...rest, [key]: draft } : rest
    },
  }

  function countFor (targetId: string): number {
    return Object.keys(drafts.value).filter(key => (JSON.parse(key) as string[])[0] === targetId).length
  }

  /** Drops every text draft of a target, e.g. when its workspace is closed. */
  function discardTarget (targetId: string): void {
    drafts.value = Object.fromEntries(Object.entries(drafts.value).filter(([key]) => (JSON.parse(key) as string[])[0] !== targetId))
  }

  return { drafts, store, countFor, discardTarget }
})
