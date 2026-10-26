import type { Target } from '#shared/contract'
import type { DesktopBridge } from '~/composables/useDesktopBridge'
import { useQueryCache } from '@pinia/colada'
import { StudioApiError } from '~/composables/useStudioApi'

export type WorkspaceAction = 'save' | 'saveAs' | 'close' | 'restore'

/**
 * Save, Save as, Close, undo and redo of an open AASX package (W8, UX-005),
 * for the package bar and the package groups of the lists. Errors show as
 * notifications. An undo or redo tells the pages through the UI store
 * (`onWorkspaceRestored`), as the bar is not part of them.
 */
export function useWorkspaceActions (target: () => Target) {
  const { t, te } = useI18n()
  const route = useRoute()
  const api = useStudioApi()
  const ui = useUiStore()
  const drafts = useDraftStore()
  const fileDrafts = useFileDraftStore()
  const queryCache = useQueryCache()
  const notifications = useNotificationsStore()

  // The bridge exists only in the Electron renderer, so read it after mounting.
  const bridge = ref<DesktopBridge | null>(null)
  onMounted(() => (bridge.value = useDesktopBridge()))

  const busy = ref<WorkspaceAction | null>(null)
  /** Close found unsaved changes: the caller asks before discarding them (UX-003). */
  const confirmClose = ref(false)

  function problemText (error: unknown): string {
    const code = error instanceof StudioApiError ? error.code : 'internal_error'
    return te(`problem.${code}`) ? t(`problem.${code}`) : t('problem.internal_error')
  }

  async function run (action: WorkspaceAction, task: () => Promise<void>) {
    busy.value = action
    try {
      await task()
    } catch (error) {
      notifications.notify({ text: problemText(error), color: 'error' })
    } finally {
      busy.value = null
    }
  }

  function updateTarget (updated: Target) {
    queryCache.setQueryData(['targets', updated.id], updated)
    void queryCache.invalidateQueries({ key: ['targets'], exact: true })
  }

  function restore (kind: 'undos' | 'redos') {
    return run('restore', async () => {
      const id = target().id
      updateTarget(await api<Target>(`/workspaces/${id}/${kind}`, { method: 'POST' }))
      ui.workspaceRestored(id)
    })
  }

  function saveAs () {
    return run('saveAs', async () => {
      const current = target()
      const grant = await bridge.value?.chooseSaveLocation(current.name)
      if (!grant) {
        return
      }
      updateTarget(await api<Target>(`/workspaces/${current.id}/exports`, { method: 'POST', body: { fileHandle: grant.handle } }))
    })
  }

  function save () {
    // A package that was never saved has no file: *Save* is *Save as*.
    if (target().workspace?.isNew && bridge.value) {
      return saveAs()
    }
    return run('save', async () => {
      updateTarget(await api<Target>(`/workspaces/${target().id}/saves`, { method: 'POST' }))
    })
  }

  /** Closes the package; with unsaved changes only if `force`, else it asks (`confirmClose`). */
  function close (force: boolean) {
    return run('close', async () => {
      const id = target().id
      try {
        await api(`/workspaces/${id}`, { method: 'DELETE', query: { force: String(force) } })
      } catch (error) {
        if (error instanceof StudioApiError && error.code === 'workspace_unsaved_changes') {
          confirmClose.value = true
          return
        }
        throw error
      }
      confirmClose.value = false
      drafts.discardTarget(id)
      fileDrafts.discardTarget(id)
      for (const entry of queryCache.getEntries({ key: ['targets', id] })) {
        queryCache.remove(entry)
      }
      void queryCache.invalidateQueries({ key: ['targets'], exact: true })
      // Away from the closed package's pages; another package stays where it is.
      if (route.params.targetId === id) {
        await navigateTo('/')
      }
    })
  }

  return { bridge, busy, confirmClose, save, saveAs, close, restore }
}

/** Runs `callback` after an undo or redo changed the package `targetId()`. */
export function onWorkspaceRestored (targetId: () => string, callback: () => unknown) {
  const ui = useUiStore()
  watch(() => ui.restored, restored => {
    if (restored?.targetId === targetId()) {
      void callback()
    }
  })
}
