import type { useFieldEditor } from './fieldEditor'
import type { InjectionKey, Ref } from 'vue'
import { inject, provide } from 'vue'

// What the rows of every contact can do, provided once by the app: open a
// link, email address, phone number or address, copy a value, and change a
// value in edit mode.

export interface RowActions {
  canEdit: Readonly<Ref<boolean>>
  editor: ReturnType<typeof useFieldEditor>
  open: (url: string) => void
  copy: (text: string) => void
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
