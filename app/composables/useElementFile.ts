import type { ElementDetail } from '#shared/contract'
import type { FileSource } from '@basyx/file-viewer/vue'
import { FileConflictError, useFileViewerState, withCachedContent } from '@basyx/file-viewer/vue'
import { externalFileUrl } from '#shared/contract'
import { StudioApiError } from '~/composables/useStudioApi'
import { fileDraftKey } from '~/stores/fileDrafts'

// The content of a File or Blob element as a source for the file viewer
// (ADR 0052): a File's from Studio's attachment route, or from its http(s)
// address in the browser and else through Studio (ADR 0042); a Blob's from
// its value. Saving writes the attachment or the Blob's value with the
// element's revision.

export interface ElementFileOptions {
  targetId: () => string
  submodelKey: () => string | null
  detail: () => ElementDetail | null
  /** The user may change the content: edit mode, rights, and uploads for Files. */
  editable: () => boolean
  /** The element after a save, e.g. to update the details. */
  onSaved?: (detail: ElementDetail) => void
  /** A save found a newer revision; the details should be read again. */
  onConflict?: () => void
}

function bytesOfBase64 (value: string): Uint8Array {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.codePointAt(i)!
  }
  return bytes
}

function base64Of (bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x80_00) {
    binary += String.fromCodePoint(...bytes.subarray(i, i + 0x80_00))
  }
  return btoa(binary)
}

/** A Blob has no file name: its idShort with the extension of its type, for downloads. */
function blobFileName (idShort: string, contentType: string): string {
  const subtype = contentType.split(';', 1)[0]!.split('/', 2)[1] ?? ''
  const extensions: Record<string, string> = { 'plain': 'txt', 'markdown': 'md', 'svg+xml': 'svg', 'jpeg': 'jpg', 'octet-stream': 'bin' }
  const extension = extensions[subtype] ?? subtype.replace(/^x-/, '').replace(/\+.*$/, '')
  return extension ? `${idShort}.${extension}` : idShort
}

/** The http(s) address of a File stored at another host (ADR 0042). */
export function externalFile (element: Record<string, unknown>): string | null {
  return element.modelType === 'File' ? externalFileUrl(element) : null
}

/** The file name of a File's value: the last segment of its path or address. */
export function fileNameOf (element: Record<string, unknown>): string {
  const value = typeof element.value === 'string' ? element.value : ''
  const path = externalFile(element) ? (URL.parse(value)?.pathname ?? value) : value
  const name = path.split('/').pop() ?? ''
  try {
    return decodeURIComponent(name)
  } catch {
    return name
  }
}

/** Whether an element has content the viewer can show: a File with a value, or a Blob with one. */
export function hasFileContent (element: Record<string, unknown> | null | undefined): boolean {
  return (element?.modelType === 'File' || element?.modelType === 'Blob') && typeof element.value === 'string' && element.value !== ''
}

export function useElementFileSource (options: ElementFileOptions) {
  const api = useStudioApi()
  const readExternalFile = useExternalFile()

  function conflictOr (error: unknown): unknown {
    if (error instanceof StudioApiError && error.code === 'revision_conflict') {
      options.onConflict?.()
      return new FileConflictError(error.message)
    }
    return error
  }

  return computed<FileSource | null>(() => {
    const detail = options.detail()
    const submodelKey = options.submodelKey()
    const element = (detail?.value ?? null) as Record<string, unknown> | null
    if (!detail || !submodelKey || !element || !hasFileContent(element)) {
      return null
    }
    const targetId = options.targetId()
    const elementPath = `/targets/${targetId}/submodels/${submodelKey}/elements/${detail.key}`
    const value = String(element.value)
    const contentType = typeof element.contentType === 'string' ? element.contentType : ''
    const revision = detail.revision ?? ''
    const external = externalFile(element)
    const editable = options.editable() && Boolean(detail.revision) && !external
    const draft = { key: fileDraftKey(targetId, submodelKey, detail.key), version: revision }
    const save = async (request: () => Promise<ElementDetail>) => {
      try {
        options.onSaved?.(await request())
      } catch (error) {
        throw conflictOr(error)
      }
    }

    if (element.modelType === 'Blob') {
      return withCachedContent({
        key: `${targetId}:${submodelKey}:${detail.key}:${revision}:${value.length}`,
        name: blobFileName(String(element.idShort ?? 'blob'), contentType),
        contentType,
        draft,
        load: async () => ({ bytes: bytesOfBase64(value), contentType }),
        save: editable
          ? bytes => save(() => api<ElementDetail>(elementPath, {
            method: 'PUT',
            headers: { 'If-Match': `"${revision}"` },
            body: { element: { ...element, value: base64Of(bytes) } },
          }))
          : undefined,
      })
    }

    const name = fileNameOf(element)
    return withCachedContent({
      key: `${targetId}:${submodelKey}:${detail.key}:${revision}:${value}`,
      name,
      contentType,
      external,
      draft,
      load: async signal => {
        if (external) {
          return readExternalFile(external, { targetId, submodelKey, elementKey: detail.key })
        }
        const blob = await api<Blob>(`${elementPath}/attachment`, { responseType: 'blob', signal })
        return { bytes: new Uint8Array(await blob.arrayBuffer()), contentType: blob.type || contentType }
      },
      save: editable
        ? bytes => save(() => api<ElementDetail>(`${elementPath}/attachment`, {
          method: 'PUT',
          query: { fileName: name },
          headers: { 'If-Match': `"${revision}"`, 'Content-Type': contentType || 'application/octet-stream' },
          body: new Blob([bytes as BlobPart], { type: contentType || 'application/octet-stream' }),
        }))
        : undefined,
    })
  })
}

/** A File or Blob element in the file viewer: its source and the state every view of it shares. */
export function useElementFile (options: ElementFileOptions) {
  const fileDrafts = useFileDraftStore()
  const source = useElementFileSource(options)
  const state = useFileViewerState(source, { drafts: fileDrafts.store })
  return { source, state }
}
