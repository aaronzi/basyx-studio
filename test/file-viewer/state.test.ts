import type { FileContent, FileSource } from '../../packages/file-viewer/src/state'
import { describe, expect, it } from 'vitest'
import { effectScope, nextTick, shallowRef } from 'vue'
import { FileConflictError, useFileViewerState } from '../../packages/file-viewer/src/state'

// The file viewer's state (packages/file-viewer/src/state.ts, ADR 0052): one
// file as every view of it shows it, read once, with its unsaved text.

const text = (value: string): FileContent => ({ bytes: new TextEncoder().encode(value), contentType: 'text/plain' })

function source (overrides: Partial<FileSource> = {}): FileSource {
  return { key: 'a', name: 'notes.txt', contentType: 'text/plain', load: async () => text('Hello'), ...overrides }
}

function inScope<T> (run: () => T): T {
  return effectScope().run(run)!
}

describe('useFileViewerState', () => {
  it('keeps loading when the host builds a new source object for the same file', async () => {
    let finish!: (content: FileContent) => void
    const current = shallowRef<FileSource>(source({ load: () => new Promise(resolve => (finish = resolve)) }))
    const state = inScope(() => useFileViewerState(current))
    const loading = state.load()
    // E.g. the user's rights arrived: the same file, another object.
    current.value = { ...current.value, save: async () => {} }
    await nextTick()
    finish(text('Hello'))
    await loading
    expect(state.status.value).toBe('ready')
    expect(state.text.value).toBe('Hello')
    expect(state.editable.value).toBe(true)
  })

  it('reads a new file when the key changes', async () => {
    const current = shallowRef(source())
    const state = inScope(() => useFileViewerState(current))
    await state.load()
    current.value = source({ key: 'b', load: async () => text('Other') })
    await nextTick()
    await new Promise(resolve => setTimeout(resolve))
    expect(state.text.value).toBe('Other')
  })

  it('keeps unsaved text in the draft store and marks it outdated on a new version', async () => {
    const drafts = new Map<string, { version: string, text: string }>()
    const store = { get: (key: string) => drafts.get(key), set: (key: string, draft?: { version: string, text: string }) => (draft ? drafts.set(key, draft) : drafts.delete(key)) }
    const current = shallowRef(source({ draft: { key: 'notes', version: '1' }, save: async () => {} }))
    const first = inScope(() => useFileViewerState(current, { drafts: store }))
    await first.load()
    first.setText('Hello, edited')
    await nextTick()
    expect(drafts.get('notes')).toEqual({ version: '1', text: 'Hello, edited' })

    // Another view of a newer version restores it, marked as based on an older one.
    const second = inScope(() => useFileViewerState(shallowRef(source({ key: 'a2', draft: { key: 'notes', version: '2' }, save: async () => {} })), { drafts: store }))
    await second.load()
    expect(second.text.value).toBe('Hello, edited')
    expect(second.draftOutdated.value).toBe(true)
    second.discard()
    expect(drafts.has('notes')).toBe(false)
  })

  it('saves in the file\'s encoding and reports a conflict', async () => {
    const saved: Uint8Array[] = []
    let conflict = false
    const current = shallowRef(source({
      load: async () => ({ bytes: new Uint8Array([0x47, 0x72, 0xF6, 0xDF, 0x65]), contentType: 'text/plain' }),
      save: async bytes => {
        if (conflict) {
          throw new FileConflictError()
        }
        saved.push(bytes)
      },
    }))
    const state = inScope(() => useFileViewerState(current))
    await state.load()
    state.setText('Größe!')
    expect(await state.save()).toBe(true)
    // windows-1252, as the file was read.
    expect([...saved[0]!]).toEqual([0x47, 0x72, 0xF6, 0xDF, 0x65, 0x21])
    expect(state.dirty.value).toBe(false)

    conflict = true
    state.setText('Größe?')
    expect(await state.save()).toBe(false)
    expect(state.saveError.value).toBeInstanceOf(FileConflictError)
    expect(state.dirty.value).toBe(true)
  })
})
