import { defineStore } from 'pinia'

/**
 * Layout and interaction state of the shell browser: view or edit mode, the
 * command palette and the drawers. Never holds target data.
 */
export const useUiStore = defineStore('ui', () => {
  /** In view mode, edit controls are hidden even where the target allows edits (plan D8). */
  const mode = ref<'view' | 'edit'>('view')
  const commandOpen = ref(false)
  /** `null` lets the drawer decide by screen size. */
  const listDrawer = ref<boolean | null>(null)
  const detailsDrawer = ref(false)
  /** The import dialog of the current target, with a file dropped on the page if any. */
  const uploadOpen = ref(false)
  const uploadFile = shallowRef<File | null>(null)
  /** The shell whose page imports: the file's submodels are referenced from it. */
  const uploadShellKey = ref<string | null>(null)
  /** Easter egg: the arcade theme, toggled with the Konami code until the next reload. */
  const arcade = ref(false)
  /** The last undo or redo of a package (`onWorkspaceRestored`); a new object each time. */
  const restored = shallowRef<{ targetId: string } | null>(null)

  function workspaceRestored (targetId: string) {
    restored.value = { targetId }
  }

  const editing = computed(() => mode.value === 'edit')

  function toggleMode () {
    mode.value = mode.value === 'edit' ? 'view' : 'edit'
  }

  function openUpload (file: File | null = null, shellKey: string | null = null) {
    uploadFile.value = file
    uploadShellKey.value = shellKey
    uploadOpen.value = true
  }

  return { mode, editing, commandOpen, listDrawer, detailsDrawer, uploadOpen, uploadFile, uploadShellKey, arcade, restored, toggleMode, openUpload, workspaceRestored }
})
