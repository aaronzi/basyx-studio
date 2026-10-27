import type { useFieldEditor } from './fieldEditor'
import type { FileRef } from './nameplate'
import type { InjectionKey, Ref } from 'vue'
import { inject, provide } from 'vue'

// What the rows of every section can do, provided once by the app: open a
// link or address, copy a value, show a file in Studio's viewer, and change
// a value in edit mode.

export interface RowActions {
  canEdit: Readonly<Ref<boolean>>
  editor: ReturnType<typeof useFieldEditor>
  open: (url: string) => void
  copy: (text: string) => void
  preview: (file: FileRef) => void
}

const key: InjectionKey<RowActions> = Symbol('row-actions')

export function provideRowActions (actions: RowActions) {
  provide(key, actions)
}

export function useRowActions (): RowActions {
  const actions = inject(key)
  if (!actions) {
    throw new Error('useRowActions() needs provideRowActions() in the app.')
  }
  return actions
}
