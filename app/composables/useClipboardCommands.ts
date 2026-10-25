import type { StructureAction } from '~/stores/structureActions'
import { useHotkey } from 'vuetify'

/** What ⌘C or ⌘V does on a page right now, e.g. copy the selected element. */
export interface ClipboardCommand {
  title: string
  run: () => unknown
}

/**
 * ⌘C and ⌘V (Ctrl elsewhere) outside text fields, and the same two commands
 * for the command palette with their shortcuts (package editing plan, K10).
 * Selected text keeps the browser's own copy. Both callbacks say what the
 * keys do now, or `null` when they do nothing here.
 */
export function useClipboardCommands (copy: () => ClipboardCommand | null, paste: () => ClipboardCommand | null) {
  const hasTextSelection = () => (globalThis.getSelection?.()?.toString() ?? '') !== ''
  useHotkey('cmd+c', event => {
    const command = hasTextSelection() ? null : copy()
    if (command) {
      event.preventDefault()
      void command.run()
    }
  }, { inputs: false })
  useHotkey('cmd+v', event => {
    const command = paste()
    if (command) {
      event.preventDefault()
      void command.run()
    }
  }, { inputs: false })

  return computed<StructureAction[]>(() => {
    const copying = copy()
    const pasting = paste()
    return [
      ...(copying ? [{ key: 'clipboard:copy', title: copying.title, icon: 'mdi-content-copy', keys: 'cmd+c', run: () => void copying.run() }] : []),
      ...(pasting ? [{ key: 'clipboard:paste', title: pasting.title, icon: 'mdi-content-paste', keys: 'cmd+v', run: () => void pasting.run() }] : []),
    ]
  })
}
