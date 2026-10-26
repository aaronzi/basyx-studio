import type { ElementDetail } from '#shared/contract'
import { useQueryCache } from '@pinia/colada'

/**
 * Studio's full-screen file viewer for a File or Blob element an app names
 * (`studio.ui.previewFile`, ADR 0052). Studio reads the element as the user,
 * and the viewer follows Studio's own rules: texts are editable in edit mode
 * where the target lets the user change the content.
 */
export function useFilePreview (targetId: () => string | null) {
  const api = useStudioApi()
  const ui = useUiStore()
  const session = useSessionStore()
  const dialog = useFileViewerDialogStore()
  const queryCache = useQueryCache()
  const target = useTarget(() => targetId() ?? '')

  const shown = shallowRef<{ submodelKey: string, detail: ElementDetail, readOnly: boolean } | null>(null)
  const elementPath = () => `/targets/${targetId()}/submodels/${shown.value?.submodelKey}/elements/${shown.value?.detail.key}`

  async function reread () {
    const current = shown.value
    if (current) {
      const detail = await api<ElementDetail>(elementPath())
      if (shown.value === current) {
        shown.value = { ...current, detail }
      }
    }
  }

  const { state } = useElementFile({
    targetId: () => targetId() ?? '',
    submodelKey: () => shown.value?.submodelKey ?? null,
    detail: () => shown.value?.detail ?? null,
    editable: () => {
      const capabilities = target.data.value?.capabilities
      if (!ui.editing || !capabilities?.write || shown.value?.readOnly) {
        return false
      }
      return (shown.value?.detail.value as Record<string, unknown> | undefined)?.modelType === 'Blob'
        ? capabilities.writeStructure
        : capabilities.files && (session.context?.features.uploads ?? true)
    },
    onSaved: (detail, origin) => {
      // Only the file the save started from: another may show by now.
      if (shown.value && shown.value.submodelKey === origin.submodelKey && shown.value.detail.key === origin.elementKey) {
        shown.value = { ...shown.value, detail }
      }
      // The details pane and app views read the element again.
      void queryCache.invalidateQueries({ key: ['targets', targetId() ?? '', 'details'] })
    },
    onConflict: () => void reread(),
  })

  /** Opens the viewer once the element is read; fails for elements without content. `readOnly` for embedded views. */
  return async function previewFile (submodelKey: string, elementKey: string, options: { readOnly?: boolean } = {}): Promise<void> {
    const detail = await api<ElementDetail>(`/targets/${targetId()}/submodels/${submodelKey}/elements/${elementKey}`)
    if (!hasFileContent(detail.value as Record<string, unknown>)) {
      throw new StudioApiError({ type: 'about:blank', title: 'The element is no File or Blob with content.', status: 422, code: 'unsupported_operation', requestId: '', retryable: false })
    }
    shown.value = { submodelKey, detail, readOnly: options.readOnly ?? false }
    dialog.open(state, () => (shown.value = null))
  }
}
