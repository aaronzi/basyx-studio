import type { Entry } from './fileSystem'
import type { JsonObject, StudioClient } from '@basyx/studio-sdk'
import { putAttachmentMaxBytes, StudioError } from '@basyx/studio-sdk'
import { copyOf, entryOf, fileIdShort, isWithin, newFolder, parentOf, renamed, unique } from './fileSystem'

// The changes of the FileSystem view (Studio app API 0.1.5, ADR 0049). Each
// write is based on a revision read just before it. BaSyx Go keeps a File's
// content at its idShort path, so nothing here changes the idShort of a
// File or of a folder that holds one: folders are renamed by displayName,
// and files and folders move by being created at the new place, with the
// content uploaded again, before the old ones are deleted, and only if they
// did not change meanwhile.

/** A file to upload, e.g. from `<input type="file">`. */
export interface Upload {
  name: string
  type: string
  bytes: Uint8Array
}

/** Thrown before any write for a file above `putAttachmentMaxBytes`. */
export class TooLargeError extends Error {
  constructor (readonly fileName: string) {
    super(`${fileName} is larger than ${putAttachmentMaxBytes / 1024 / 1024} MiB.`)
    this.name = 'TooLargeError'
  }
}

export class FileSystemWriter {
  constructor (private readonly client: StudioClient, private readonly submodelId: string) {}

  /** Uploads a file into a folder (`''` for the top level); returns its path. */
  async upload (folder: string, file: Upload): Promise<string> {
    if (file.bytes.byteLength > putAttachmentMaxBytes) {
      throw new TooLargeError(file.name)
    }
    const contentType = file.type || 'application/octet-stream'
    const level = await this.#level(folder)
    const added = await this.#add(folder, { modelType: 'File', idShort: fileIdShort(file.name, level.idShorts), contentType }, level.structureRevision)
    try {
      await this.client.aas.putAttachment({ submodelId: this.submodelId, idShortPath: added.idShortPath, fileName: file.name, contentType, data: file.bytes, revision: added.revision })
    } catch (error) {
      // No empty File is left behind.
      await this.client.aas.deleteElement({ submodelId: this.submodelId, idShortPath: added.idShortPath, revision: added.revision }).catch(() => {})
      throw error
    }
    return added.idShortPath
  }

  /** Creates a folder in a folder (`''` for the top level); returns its path. */
  async createFolder (folder: string, name: string): Promise<string> {
    const level = await this.#level(folder)
    return (await this.#add(folder, newFolder(name, level.idShorts), level.structureRevision)).idShortPath
  }

  /** Renames a folder or file by its displayName; its idShort and content stay. */
  async rename (entry: Entry, name: string, locale: string): Promise<void> {
    const current = await this.client.aas.getElement(this.submodelId, entry.path)
    const { value: _children, ...element } = current.value
    // A container keeps its children; a File keeps its value and so its content.
    const next = renamed(entry.kind === 'folder' ? element : current.value, name, locale)
    await this.client.aas.putElement({ submodelId: this.submodelId, idShortPath: entry.path, element: next, revision: current.revision })
  }

  /** Deletes a file, or a folder with everything in it. */
  async delete (entry: Entry): Promise<void> {
    const current = await this.client.aas.getElement(this.submodelId, entry.path)
    await this.client.aas.deleteElement({ submodelId: this.submodelId, idShortPath: entry.path, revision: current.revision })
  }

  /**
   * Moves a file or folder into a folder (`''` for the top level): creates it
   * there from the source as it is now, with each file's content uploaded
   * again, then deletes the source based on the revision it was copied from.
   * If the source changed meanwhile, or the copy fails, the copy is removed
   * again and the source stays. Returns the new path.
   */
  async move (entry: Entry, folder: string): Promise<string> {
    if (entry.parent === folder) {
      return entry.path
    }
    if (entry.kind === 'folder' && isWithin(folder, entry.path)) {
      throw new StudioError({ code: 'invalid_request', title: 'A folder cannot be moved into itself.', status: 400, retryable: false })
    }
    const source = await this.client.aas.getElement(this.submodelId, entry.path)
    const copy: { path: string | null } = { path: null }
    try {
      await this.#copy(entry.path, source.value, folder, copy)
      // A child added or changed during the copy changes the source's revision, so it is not lost.
      await this.client.aas.deleteElement({ submodelId: this.submodelId, idShortPath: entry.path, revision: source.revision })
    } catch (error) {
      if (copy.path) {
        await this.#remove(copy.path)
      }
      throw error
    }
    return copy.path!
  }

  /** The children's idShorts and structure revision of a folder, or of the top level for `''`. */
  async #level (folder: string): Promise<{ idShorts: string[], structureRevision: string }> {
    if (!folder) {
      const snapshot = await this.client.aas.getSubmodelSnapshot(this.submodelId)
      return { idShorts: idShortsOf(snapshot.submodel.submodelElements), structureRevision: snapshot.structureRevision }
    }
    const snapshot = await this.client.aas.getElement(this.submodelId, folder)
    return { idShorts: idShortsOf(snapshot.value.value), structureRevision: snapshot.structureRevision! }
  }

  async #add (folder: string, element: JsonObject, structureRevision: string) {
    return this.client.aas.addElement({ submodelId: this.submodelId, element, structureRevision, ...(folder ? { parentPath: folder } : {}) })
  }

  /**
   * Copies an element of the source, as read, into a folder: folders with
   * their children, files with their content, other elements as they are.
   * Children are classified from the element itself, not from what the view
   * showed, so one added since then keeps its content. `copy.path` is set as
   * soon as the top element exists, so a failure can remove it.
   */
  async #copy (path: string, element: JsonObject, folder: string, copy: { path: string | null }): Promise<string> {
    const entry = entryOf(element, parentOf(path), 'en')
    const content = entry?.kind === 'file' && !entry.external ? await this.#content(path) : null
    if (entry?.kind === 'file' && content && content.bytes.byteLength > putAttachmentMaxBytes) {
      throw new TooLargeError(entry.fileName)
    }
    const level = await this.#level(folder)
    const idShort = unique(String(element.idShort), level.idShorts)
    const added = await this.#add(folder, entry ? copyOf(element, idShort) : { ...element, idShort }, level.structureRevision)
    copy.path ??= added.idShortPath
    if (entry?.kind === 'file' && content) {
      await this.client.aas.putAttachment({ submodelId: this.submodelId, idShortPath: added.idShortPath, fileName: entry.fileName, contentType: content.contentType, data: content.bytes, revision: added.revision })
    }
    if (entry?.kind === 'folder') {
      for (const child of Array.isArray(element.value) ? element.value as JsonObject[] : []) {
        if (typeof child.idShort === 'string') {
          await this.#copy(`${path}.${child.idShort}`, child, added.idShortPath, copy)
        }
      }
    }
    return added.idShortPath
  }

  /** Removes a copy that could not be completed; what is left of it stays if that fails. */
  async #remove (path: string): Promise<void> {
    try {
      const current = await this.client.aas.getElement(this.submodelId, path)
      await this.client.aas.deleteElement({ submodelId: this.submodelId, idShortPath: path, revision: current.revision })
    } catch {
      // The original problem is the one to report.
    }
  }

  /** A File's content, or `null` when it has none. */
  async #content (path: string) {
    try {
      return await this.client.ui.readFile(this.submodelId, path)
    } catch (error) {
      if (error instanceof StudioError && error.code === 'target_resource_not_found') {
        return null
      }
      throw error
    }
  }
}

function idShortsOf (elements: unknown): string[] {
  return Array.isArray(elements) ? (elements as JsonObject[]).map(element => element.idShort).filter((idShort): idShort is string => typeof idShort === 'string') : []
}
