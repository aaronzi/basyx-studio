import type { Entry, FileEntry, FolderEntry } from './fileSystem'
import type { JsonObject, StudioClient } from '@basyx/studio-sdk'
import { putAttachmentMaxBytes, StudioError } from '@basyx/studio-sdk'
import { copyOf, fileIdShort, isWithin, newFolder, renamed, unique } from './fileSystem'

// The changes of the FileSystem view (Studio app API 0.1.5, ADR 0049). Each
// write is based on a revision read just before it. BaSyx Go keeps a File's
// content at its idShort path, so nothing here changes the idShort of a
// File or of a folder that holds one: folders are renamed by displayName,
// and files and folders move by being created at the new place, with the
// content uploaded again, before the old ones are deleted.

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
   * there, with each file's content uploaded again, and deletes the old one.
   * Returns the new path.
   */
  async move (entry: Entry, folder: string): Promise<string> {
    if (entry.parent === folder) {
      return entry.path
    }
    if (entry.kind === 'folder' && isWithin(folder, entry.path)) {
      throw new StudioError({ code: 'invalid_request', title: 'A folder cannot be moved into itself.', status: 400, retryable: false })
    }
    const path = entry.kind === 'folder' ? await this.#copyFolder(entry, folder) : await this.#copyFile(entry, folder)
    await this.delete(entry)
    return path
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

  async #copyFile (entry: FileEntry, folder: string): Promise<string> {
    // Read first: a file that cannot be read is not moved.
    const content = entry.external ? null : await this.#content(entry)
    if (content && content.bytes.byteLength > putAttachmentMaxBytes) {
      throw new TooLargeError(entry.fileName)
    }
    const current = await this.client.aas.getElement(this.submodelId, entry.path)
    const level = await this.#level(folder)
    const added = await this.#add(folder, copyOf(current.value, unique(entry.idShort, level.idShorts)), level.structureRevision)
    if (content) {
      await this.client.aas.putAttachment({ submodelId: this.submodelId, idShortPath: added.idShortPath, fileName: entry.fileName, contentType: content.contentType, data: content.bytes, revision: added.revision })
    }
    return added.idShortPath
  }

  async #copyFolder (entry: FolderEntry, folder: string): Promise<string> {
    const current = await this.client.aas.getElement(this.submodelId, entry.path)
    const level = await this.#level(folder)
    const added = await this.#add(folder, copyOf(current.value, unique(entry.idShort, level.idShorts)), level.structureRevision)
    const children = Array.isArray(current.value.value) ? current.value.value as JsonObject[] : []
    for (const child of children) {
      const listed = entry.children.find(candidate => candidate.idShort === child.idShort)
      if (listed?.kind === 'folder') {
        await this.#copyFolder(listed, added.idShortPath)
      } else if (listed?.kind === 'file') {
        await this.#copyFile(listed, added.idShortPath)
      } else if (typeof child.idShort === 'string') {
        // Other elements the folder holds move along as they are.
        const inner = await this.#level(added.idShortPath)
        await this.#add(added.idShortPath, child, inner.structureRevision)
      }
    }
    return added.idShortPath
  }

  /** A File's content, or `null` when it has none. */
  async #content (entry: FileEntry) {
    try {
      return await this.client.ui.readFile(this.submodelId, entry.path)
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
