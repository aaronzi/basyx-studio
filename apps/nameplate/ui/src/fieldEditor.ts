import type { LangString, TextField } from '@basyx/studio-app-kit/aas'
import type { Translate } from '@basyx/studio-app-kit/i18n'
import type { StudioClient } from '@basyx/studio-sdk'
import { StudioError } from '@basyx/studio-sdk'
import { ref } from 'vue'

// Changing a Property's or MultiLanguageProperty's value in place, in
// Studio's edit mode: the value is read again for its revision when editing
// starts, and the write is based on it, so a change made in the meantime is
// a conflict, not overwritten. A MultiLanguageProperty is changed in the
// language the view shows; its other languages stay.

export interface Draft {
  field: TextField
  label: string
  value: string
  /** The language a MultiLanguageProperty's text is changed in; empty for a Property. */
  language: string
  revision: string
  /** The value as read now, a MultiLanguageProperty's texts in every language. */
  values: LangString[]
  error: string | null
}

/** The language of the text the view shows: the locale's, else English, else the first; the locale's for none. */
export function editLanguage (values: LangString[], locale: string): string {
  const language = locale.split('-', 1)[0]!
  return (values.find(entry => entry.language.startsWith(language)) ?? values.find(entry => entry.language.startsWith('en')) ?? values[0])?.language || language
}

/** The value to write: a Property's text (`null` when empty), or the texts with this language's changed (dropped when empty). */
export function draftValue (draft: Pick<Draft, 'field' | 'value' | 'language' | 'values'>): string | null | LangString[] {
  const value = draft.value.trim()
  if (draft.field.modelType === 'Property') {
    return value === '' ? null : value
  }
  // Plain objects: the draft's are Vue proxies, which postMessage cannot clone.
  const values = draft.values.map(entry => ({ language: entry.language, text: entry.text }))
  const others = values.filter(entry => entry.language !== draft.language)
  const index = values.findIndex(entry => entry.language === draft.language)
  if (value === '') {
    return others
  }
  const changed = [...values]
  if (index === -1) {
    changed.push({ language: draft.language, text: value })
  } else {
    changed[index] = { language: draft.language, text: value }
  }
  return changed
}

export function describeWriteError (t: Translate, cause: unknown): string {
  if (!(cause instanceof StudioError)) {
    return String(cause)
  }
  switch (cause.code) {
    case 'revision_conflict': {
      return t('edit.conflict')
    }
    case 'target_forbidden': {
      return t('edit.forbidden')
    }
    default: {
      return cause.message
    }
  }
}

export function useFieldEditor (options: { client: StudioClient, t: Translate, locale: () => string, submodelId: () => string, onSaved: (label: string) => Promise<void> }) {
  const draft = ref<Draft | null>(null)
  const saving = ref(false)
  /** A value that could not be read for editing. */
  const error = ref<string | null>(null)

  async function start (field: TextField, label: string) {
    error.value = null
    try {
      const snapshot = await options.client.aas.getElement(options.submodelId(), field.path)
      const raw = snapshot.value.value
      const values = Array.isArray(raw)
        ? (raw as LangString[]).filter(entry => typeof entry?.text === 'string').map(entry => ({ language: String(entry.language ?? ''), text: entry.text }))
        : []
      const language = field.modelType === 'MultiLanguageProperty' ? editLanguage(values, options.locale()) : ''
      draft.value = {
        field,
        label,
        value: field.modelType === 'Property' ? String(raw ?? '') : values.find(entry => entry.language === language)?.text ?? '',
        language,
        revision: snapshot.revision,
        values,
        error: null,
      }
    } catch (error_) {
      error.value = describeWriteError(options.t, error_)
    }
  }

  async function save () {
    const current = draft.value
    if (!current) {
      return
    }
    saving.value = true
    try {
      await options.client.aas.setElementValue({ submodelId: options.submodelId(), idShortPath: current.field.path, value: draftValue(current), revision: current.revision })
      draft.value = null
      await options.onSaved(current.label)
    } catch (error_) {
      // The draft stays, as in Studio's own editor.
      current.error = describeWriteError(options.t, error_)
    } finally {
      saving.value = false
    }
  }

  function cancel () {
    draft.value = null
  }

  return { draft, saving, error, start, save, cancel }
}
