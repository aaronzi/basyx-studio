import type { ModelFormat, ViewerTheme } from '@basyx/model-viewer'
import { useModelViewer } from '@basyx/model-viewer/vue'
import { computed, shallowRef } from 'vue'
import { useFileViewerContext } from './i18n.ts'

// The 3D view's state, shared by Studio's file view and apps that draw their
// own frame around it (the 3D Models app): the viewer, the element it draws
// into (bound by `ModelCanvas`), and why a model cannot be shown, in the
// viewer's texts.

export function useModelView (theme: () => ViewerTheme) {
  const { t } = useFileViewerContext()
  const host = shallowRef<HTMLElement | null>(null)
  const viewer = useModelViewer(host, theme)

  const problemText = computed(() => {
    const problem = viewer.problem.value
    switch (problem?.code) {
      case undefined: {
        return ''
      }
      case 'webgl': {
        return t('model3d.errors.webgl')
      }
      case 'missing-buffers': {
        return t('model3d.errors.missingBuffers', { files: problem.details.join(', ') })
      }
      case 'download': {
        return t('model3d.errors.download', { message: problem.message })
      }
      default: {
        return t('model3d.errors.parse', { message: problem?.message ?? '' })
      }
    }
  })

  /** Reads and shows a model; a later call replaces it. */
  function load (download: () => Promise<Uint8Array>, format: ModelFormat): Promise<void> {
    return viewer.load(download, format)
  }

  /** Where the viewer draws; `ModelCanvas` binds its element here. */
  function setHost (element: HTMLElement | null) {
    host.value = element
  }

  return { host, viewer, problemText, load, setHost }
}

export type ModelView = ReturnType<typeof useModelView>
