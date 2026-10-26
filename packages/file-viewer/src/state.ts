import type { ViewerKindInfo } from './kinds.ts'
import type { TextEncoding } from './text.ts'
import type { MaybeRefOrGetter } from 'vue'
import { computed, ref, shallowRef, toValue, watch } from 'vue'
import { detectViewerKind, refineViewerKind } from './kinds.ts'
import { decodeText, encodeText, textLimit, truncatedTextLength } from './text.ts'

// One file as the viewer shows it, shared by every place that shows it: a
// view, its full-screen dialog and a thumbnail read the same bytes and edit
// the same text, so maximizing keeps the page, the view and unsaved changes.

export interface FileContent {
  bytes: Uint8Array
  /** The type the bytes came with; the source's declared type is preferred. */
  contentType: string
}

/** Where a file comes from and goes to; Studio and apps each build one from their transport. */
export interface FileSource {
  /** Identity of the content: another key is another file, which is loaded anew. */
  key: string
  /** The file name, also for downloads and the extension. */
  name: string
  /** The declared content type, e.g. the File element's `contentType`. */
  contentType: string
  /** The http(s) address of a file stored at another host. */
  external?: string | null
  load: (signal: AbortSignal) => Promise<FileContent>
  /** Writes changed bytes; without it, the file is read-only. */
  save?: (bytes: Uint8Array) => Promise<void>
  /** Where unsaved text is kept across views and navigation; `version` is what it is based on. */
  draft?: { key: string, version: string }
}

/** Saving failed because the file changed since it was loaded (`If-Match`). */
export class FileConflictError extends Error {
  constructor (message = 'The file was changed since it was loaded.') {
    super(message)
    this.name = 'FileConflictError'
  }
}

/** Unsaved texts, e.g. in a Pinia store, so they survive the view. */
export interface FileDraftStore {
  get: (key: string) => { version: string, text: string } | undefined
  set: (key: string, draft: { version: string, text: string } | undefined) => void
}

/** Reads each source's bytes once, also when a view and a thumbnail ask for them. */
export function withCachedContent (source: FileSource): FileSource {
  let pending: Promise<FileContent> | null = null
  return {
    ...source,
    load: signal => {
      pending ??= source.load(signal).catch(error => {
        pending = null
        throw error
      })
      return pending
    },
  }
}

export type FileViewerStatus = 'idle' | 'loading' | 'ready' | 'error'

export function useFileViewerState (sourceRef: MaybeRefOrGetter<FileSource | null>, options: { drafts?: FileDraftStore } = {}) {
  const source = computed(() => toValue(sourceRef))
  const status = ref<FileViewerStatus>('idle')
  const error = shallowRef<unknown>(null)
  const content = shallowRef<FileContent | null>(null)

  /** What the file is shown as: from its type and name, then from its bytes. */
  const detected = computed<ViewerKindInfo>(() => detectViewerKind({ contentType: source.value?.contentType, fileName: source.value?.name }))
  const info = computed<ViewerKindInfo>(() => content.value ? refineViewerKind(detected.value, content.value.bytes, source.value?.name) : detected.value)

  /** The text of a text file, or an SVG's source. */
  const decoded = computed(() => {
    const bytes = content.value?.bytes
    if (!bytes || (info.value.kind !== 'text' && info.value.alternate !== 'svg')) {
      return null
    }
    const truncated = bytes.length > textLimit
    const result = decodeText(truncated ? bytes.subarray(0, truncatedTextLength) : bytes, source.value?.contentType ?? '')
    return { ...result, truncated }
  })

  /** The text in the editor; differs from the file's while there are unsaved changes. */
  const text = ref('')
  /** The draft was made on another version of the file. */
  const draftOutdated = ref(false)
  /** The second view of the file: rendered Markdown, the CSV table, the SVG as image. */
  const showSource = ref(false)
  const wrap = ref(true)
  const page = ref(1)

  const dirty = computed(() => decoded.value !== null && text.value !== decoded.value.text)
  const saving = ref(false)
  const saveError = shallowRef<unknown>(null)

  /** Why the text cannot be edited, or `null` when it can (with a `save`). */
  const readOnlyReason = computed<'external' | 'encoding' | 'truncated' | 'source' | null>(() => {
    if (source.value?.external) {
      return 'external'
    }
    if (!source.value?.save) {
      return 'source'
    }
    if (decoded.value?.truncated) {
      return 'truncated'
    }
    return decoded.value && decoded.value.encoding === null ? 'encoding' : null
  })
  const editable = computed(() => info.value.kind === 'text' && decoded.value !== null && readOnlyReason.value === null)

  // Sources are compared by key: a host may build a new source object for the
  // same file whenever something it depends on changes (e.g. permissions).
  let controller: AbortController | null = null

  function reset () {
    controller?.abort()
    controller = null
    status.value = 'idle'
    error.value = null
    content.value = null
    text.value = ''
    draftOutdated.value = false
    saveError.value = null
    showSource.value = false
    page.value = 1
  }

  function restoreDraft () {
    const draft = source.value?.draft
    const stored = draft ? options.drafts?.get(draft.key) : undefined
    if (stored && decoded.value && stored.text !== decoded.value.text) {
      text.value = stored.text
      draftOutdated.value = stored.version !== draft!.version
    } else {
      text.value = decoded.value?.text ?? ''
      draftOutdated.value = false
    }
  }

  /** Loads the bytes unless they are there or on their way; views call it when they show. */
  async function load (): Promise<void> {
    const current = source.value
    if (!current || status.value === 'loading' || status.value === 'ready') {
      return
    }
    controller = new AbortController()
    const signal = controller.signal
    status.value = 'loading'
    error.value = null
    try {
      const loaded = await current.load(signal)
      if (signal.aborted || current.key !== source.value?.key) {
        return
      }
      content.value = loaded
      restoreDraft()
      status.value = 'ready'
    } catch (error_) {
      if (signal.aborted || current.key !== source.value?.key) {
        return
      }
      error.value = error_
      status.value = 'error'
    }
  }

  function retry () {
    reset()
    void load()
  }

  // Another file, or a new version of it (e.g. after a save elsewhere): read it anew.
  watch(() => source.value?.key, (key, previous) => {
    if (key !== previous) {
      const wasShown = status.value !== 'idle'
      reset()
      if (wasShown && key) {
        void load()
      }
    }
  })

  // Unsaved text is kept in the draft store as it is typed.
  watch(text, value => {
    const draft = source.value?.draft
    if (!draft || !options.drafts || status.value !== 'ready' || !decoded.value) {
      return
    }
    options.drafts.set(draft.key, value === decoded.value.text ? undefined : { version: draft.version, text: value })
  })

  function discard () {
    const draft = source.value?.draft
    if (draft) {
      options.drafts?.set(draft.key, undefined)
    }
    text.value = decoded.value?.text ?? ''
    draftOutdated.value = false
    saveError.value = null
  }

  /** Saves the text in the file's encoding; on success the file is the saved bytes. */
  async function save (): Promise<boolean> {
    const current = source.value
    if (!current?.save || !decoded.value?.encoding || !dirty.value) {
      return false
    }
    saving.value = true
    saveError.value = null
    try {
      const bytes = encodeText(text.value, decoded.value.encoding as TextEncoding)
      await current.save(bytes)
      if (current.draft) {
        options.drafts?.set(current.draft.key, undefined)
      }
      if (current.key === source.value?.key) {
        content.value = { bytes, contentType: content.value?.contentType ?? current.contentType }
        text.value = decoded.value?.text ?? text.value
        draftOutdated.value = false
      }
      return true
    } catch (error_) {
      saveError.value = error_
      return false
    } finally {
      saving.value = false
    }
  }

  // Setters for the views, which get the state as a prop.
  const setText = (value: string) => (text.value = value)
  const setShowSource = (value: boolean) => (showSource.value = value)
  const toggleWrap = () => (wrap.value = !wrap.value)
  const setPage = (value: number) => (page.value = value)
  const clearSaveError = () => (saveError.value = null)

  return {
    source,
    status,
    error,
    content,
    detected,
    info,
    decoded,
    text,
    dirty,
    draftOutdated,
    editable,
    readOnlyReason,
    showSource,
    wrap,
    page,
    saving,
    saveError,
    load,
    retry,
    save,
    discard,
    setText,
    setShowSource,
    toggleWrap,
    setPage,
    clearSaveError,
  }
}

export type FileViewerState = ReturnType<typeof useFileViewerState>
