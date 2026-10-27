import type { FileViewerState } from '@basyx/file-viewer/vue'
import { defineStore } from 'pinia'

/**
 * The full-screen file viewer (ADR 0052): one dialog for every file Studio
 * or an app shows full-screen. It shows the state of the view it was opened
 * from, so page, view and unsaved text carry over; `onClose` releases a state
 * made only for the dialog (e.g. for `studio.ui.previewFile`).
 */
export const useFileViewerDialogStore = defineStore('fileViewerDialog', () => {
  const state = shallowRef<FileViewerState | null>(null)
  let release: (() => void) | null = null

  function open (next: FileViewerState, onClose?: () => void) {
    close()
    state.value = markRaw(next)
    release = onClose ?? null
  }

  function close () {
    state.value = null
    release?.()
    release = null
  }

  return { state, open, close }
})
