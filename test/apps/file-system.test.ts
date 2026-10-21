import type { FolderEntry } from '../../apps/file-system/ui/src/fileSystem'
import type { JsonObject } from '@basyx/studio-sdk'
import { putAttachmentMaxBytes } from '@basyx/studio-sdk'
import { createTestStudio, memoryAas } from '@basyx/studio-sdk/testing'
import { describe, expect, it } from 'vitest'
import { childrenAt, fileIdShort, findEntry, flatten, iconColorOf, iconOf, newFolder, parentOf, previewKind, readFileSystem, renamed, trail } from '../../apps/file-system/ui/src/fileSystem'
import { FileSystemWriter, TooLargeError } from '../../apps/file-system/ui/src/operations'

// The bundled FileSystem view (external apps plan X3): reading the
// submodel as the BaSyx AAS Web UI's FileSystem plugin writes it, and its
// changes on the test Studio's AAS in memory.

const submodelId = 'urn:example:sm:files'
const folderSemanticId = { type: 'ExternalReference', keys: [{ type: 'GlobalReference', value: 'https://basyx.org/submodels/Folder' }] }

/** A FileSystem submodel as the Web UI writes it. */
function webUiSubmodel (): JsonObject {
  return {
    modelType: 'Submodel',
    id: submodelId,
    idShort: 'FileSystem',
    semanticId: { type: 'ExternalReference', keys: [{ type: 'GlobalReference', value: 'https://basyx.org/FileSystem/FileSystem/0/1' }] },
    submodelElements: [
      { modelType: 'File', idShort: 'zeta', contentType: 'text/plain', value: '/aasx/files/abc/zeta.txt' },
      {
        modelType: 'SubmodelElementCollection',
        idShort: 'FOLDER_1700000000000',
        displayName: [{ language: 'en', text: 'Manuals' }, { language: 'de', text: 'Handbücher' }],
        semanticId: folderSemanticId,
        value: [
          { modelType: 'File', idShort: 'Guide', contentType: 'application/pdf', value: '/aasx/files/def/Guide%20v2.pdf' },
          { modelType: 'SubmodelElementCollection', idShort: 'FOLDER_1700000000001', displayName: [{ language: 'en', text: 'Old' }], semanticId: folderSemanticId },
        ],
      },
      { modelType: 'File', idShort: 'photo', contentType: 'image/png' },
      { modelType: 'File', idShort: 'Link', contentType: 'application/pdf', value: 'https://example.com/spec.pdf' },
      { modelType: 'SubmodelElementCollection', idShort: 'PreviewCollection', value: [{ modelType: 'ReferenceElement', idShort: 'photo' }] },
      { modelType: 'Property', idShort: 'Note', valueType: 'xs:string', value: 'kept' },
    ],
  }
}

describe('reading a FileSystem submodel', () => {
  it('lists folders first, then files by name, with the Web UI\'s names', () => {
    const entries = readFileSystem(webUiSubmodel(), 'en')
    expect(entries.map(entry => [entry.kind, entry.name])).toEqual([
      ['folder', 'Manuals'],
      ['file', 'photo.png'],
      ['file', 'spec.pdf'],
      ['file', 'zeta.txt'],
    ])
    const manuals = entries[0] as FolderEntry
    expect(manuals.children.map(child => [child.path, child.name])).toEqual([
      ['FOLDER_1700000000000.FOLDER_1700000000001', 'Old'],
      ['FOLDER_1700000000000.Guide', 'Guide v2.pdf'],
    ])
    expect(findEntry(entries, 'Link')).toMatchObject({ kind: 'file', external: 'https://example.com/spec.pdf' })
    // The display name follows the locale, then English.
    expect(readFileSystem(webUiSubmodel(), 'de-saar')[0]!.name).toBe('Handbücher')
    expect(flatten(entries)).toHaveLength(6)
  })

  it('navigates folders as the gallery does: their content, the breadcrumbs and the way up', () => {
    const entries = readFileSystem(webUiSubmodel(), 'en')
    expect(childrenAt(entries, '').map(entry => entry.name)).toEqual(['Manuals', 'photo.png', 'spec.pdf', 'zeta.txt'])
    expect(childrenAt(entries, 'FOLDER_1700000000000').map(entry => entry.name)).toEqual(['Old', 'Guide v2.pdf'])
    expect(childrenAt(entries, 'missing')).toEqual([])
    expect(trail(entries, 'FOLDER_1700000000000.FOLDER_1700000000001').map(entry => entry.name)).toEqual(['Manuals', 'Old'])
    expect(parentOf('FOLDER_1700000000000.FOLDER_1700000000001')).toBe('FOLDER_1700000000000')
    expect(parentOf('FOLDER_1700000000000')).toBe('')
    // Icons and colours as in the Web UI.
    expect(['Manuals', 'photo.png', 'spec.pdf', 'zeta.txt'].map(name => {
      const entry = entries.find(candidate => candidate.name === name)!
      return [iconOf(entry), iconColorOf(entry)]
    })).toEqual([['mdi-folder', 'yellow-darken-2'], ['mdi-image', 'blue-darken-2'], ['mdi-file-link', 'red'], ['mdi-file-document', 'grey']])
  })

  it('names uploads as the Web UI does, as valid and unique idShorts', () => {
    expect(fileIdShort('Prüfbericht 2024.pdf', [])).toBe('Prufbericht_2024')
    expect(fileIdShort('2024-report.final.pdf', [])).toBe('File_2024_report_final')
    expect(fileIdShort('a.txt', [])).toBe('File_a')
    expect(fileIdShort('.env', [])).toBe('File')
    expect(fileIdShort('guide.pdf', ['guide', 'Guide_2'])).toBe('guide_3')
  })

  it('creates folders without value and renames by displayName', () => {
    expect(newFolder('Specs', ['FOLDER_1'], 1)).toEqual({
      modelType: 'SubmodelElementCollection',
      idShort: 'FOLDER_1_2',
      displayName: [{ language: 'en', text: 'Specs' }],
      semanticId: folderSemanticId,
    })
    const folder = (webUiSubmodel().submodelElements as JsonObject[])[1]!
    expect(renamed(folder, 'Docs', 'de').displayName).toEqual([{ language: 'en', text: 'Docs' }, { language: 'de', text: 'Docs' }])
    expect(renamed(folder, 'Docs', 'fr').displayName).toEqual([{ language: 'en', text: 'Docs' }, { language: 'de', text: 'Handbücher' }])
    expect(renamed({ modelType: 'File', idShort: 'x' }, 'Report', 'en').displayName).toEqual([{ language: 'en', text: 'Report' }])
  })

  it('previews images, PDFs, text, audio and video', () => {
    expect(['image/png', 'application/pdf', 'text/csv', 'application/ld+json', 'video/mp4', 'audio/mpeg', 'image/tiff', 'application/zip'].map(type => previewKind(type)))
      .toEqual(['image', 'pdf', 'text', 'text', 'video', 'audio', 'none', 'none'])
  })
})

describe('changing files', () => {
  function setup () {
    const aas = memoryAas({ submodels: [webUiSubmodel()] })
    aas.setFile(submodelId, 'zeta', { bytes: new TextEncoder().encode('zeta'), contentType: 'text/plain' })
    aas.setFile(submodelId, 'FOLDER_1700000000000.Guide', { bytes: new TextEncoder().encode('%PDF-guide'), contentType: 'application/pdf' })
    const studio = createTestStudio({ handlers: aas.handlers, context: { mode: 'edit', submodel: { id: submodelId, semanticId: null } } })
    const writer = new FileSystemWriter(studio.client, submodelId)
    const entries = () => readFileSystem(aas.submodels[0]!, 'en')
    const read = async (path: string) => new TextDecoder().decode((await studio.client.ui.readFile(submodelId, path)).bytes)
    return { aas, studio, writer, entries, read }
  }

  it('uploads into a folder and refuses files above 8 MiB before writing', async () => {
    const { writer, entries, read, studio } = setup()
    const path = await writer.upload('FOLDER_1700000000000', { name: 'Guide.pdf', type: 'application/pdf', bytes: new TextEncoder().encode('%PDF-new') })
    expect(path).toBe('FOLDER_1700000000000.Guide_2')
    expect(await read(path)).toBe('%PDF-new')
    expect(findEntry(entries(), path)).toMatchObject({ name: 'Guide.pdf', contentType: 'application/pdf' })

    const calls = studio.calls.length
    await expect(writer.upload('', { name: 'big.bin', type: '', bytes: new Uint8Array(putAttachmentMaxBytes + 1) })).rejects.toBeInstanceOf(TooLargeError)
    expect(studio.calls).toHaveLength(calls)
  })

  it('creates and renames folders, and keeps a file\'s content when renaming it', async () => {
    const { writer, entries, read } = setup()
    const path = await writer.createFolder('', 'Drawings')
    expect(path).toMatch(/^FOLDER_\d+$/)
    expect(findEntry(entries(), path)).toMatchObject({ kind: 'folder', name: 'Drawings' })

    await writer.rename(findEntry(entries(), 'FOLDER_1700000000000')!, 'Handbooks', 'en')
    const folder = findEntry(entries(), 'FOLDER_1700000000000') as FolderEntry
    expect(folder.name).toBe('Handbooks')
    expect(folder.children).toHaveLength(2)

    await writer.rename(findEntry(entries(), 'zeta')!, 'Zeta notes', 'en')
    expect(findEntry(entries(), 'zeta')!.name).toBe('Zeta notes')
    expect(await read('zeta')).toBe('zeta')
  })

  it('moves files and folders with their content, and never into themselves', async () => {
    const { writer, entries, read, aas } = setup()
    const moved = await writer.move(findEntry(entries(), 'zeta')!, 'FOLDER_1700000000000.FOLDER_1700000000001')
    expect(moved).toBe('FOLDER_1700000000000.FOLDER_1700000000001.zeta')
    expect(await read(moved)).toBe('zeta')
    expect(findEntry(entries(), 'zeta')).toBeNull()

    const manuals = findEntry(entries(), 'FOLDER_1700000000000')!
    await expect(writer.move(manuals, 'FOLDER_1700000000000.FOLDER_1700000000001')).rejects.toMatchObject({ code: 'invalid_request' })

    // A folder moves with everything in it, to the top level of another folder.
    const target = await writer.createFolder('', 'Archive')
    const folderPath = await writer.move(manuals, target)
    expect(folderPath).toBe(`${target}.FOLDER_1700000000000`)
    expect(await read(`${folderPath}.Guide`)).toBe('%PDF-guide')
    expect(await read(`${folderPath}.FOLDER_1700000000001.zeta`)).toBe('zeta')
    expect(findEntry(entries(), folderPath)).toMatchObject({ name: 'Manuals' })
    expect(findEntry(entries(), 'FOLDER_1700000000000')).toBeNull()

    // Files without content and external files move as elements.
    const photo = await writer.move(findEntry(entries(), 'photo')!, target)
    const link = await writer.move(findEntry(entries(), 'Link')!, target)
    expect(findEntry(entries(), link)).toMatchObject({ external: 'https://example.com/spec.pdf' })
    expect(photo).toBe(`${target}.photo`)
    // Elements the view does not show stay where they are.
    expect((aas.submodels[0]!.submodelElements as JsonObject[]).map(element => element.idShort)).toEqual(expect.arrayContaining(['PreviewCollection', 'Note']))
  })

  it('keeps the source of a move that changed while it was copied, and removes the copy', async () => {
    const aas = memoryAas({ submodels: [webUiSubmodel()] })
    aas.setFile(submodelId, 'FOLDER_1700000000000.Guide', { bytes: new TextEncoder().encode('%PDF-guide'), contentType: 'application/pdf' })
    let inserted = false
    const studio = createTestStudio({
      context: { mode: 'edit', submodel: { id: submodelId, semanticId: null } },
      handlers: {
        ...aas.handlers,
        // Someone else adds a file to the source folder while its content is copied.
        'studio.aas.putAttachment': async (params, test) => {
          const result = await aas.handlers['studio.aas.putAttachment']!(params, test)
          if (!inserted) {
            inserted = true
            const folder = (aas.submodels[0]!.submodelElements as JsonObject[]).find(element => element.idShort === 'FOLDER_1700000000000')!
            ;(folder.value as JsonObject[]).push({ modelType: 'File', idShort: 'Concurrent', contentType: 'text/plain' })
          }
          return result
        },
      },
    })
    const writer = new FileSystemWriter(studio.client, submodelId)
    const target = await writer.createFolder('', 'Archive')
    const manuals = findEntry(readFileSystem(aas.submodels[0]!, 'en'), 'FOLDER_1700000000000')!
    await expect(writer.move(manuals, target)).rejects.toMatchObject({ code: 'revision_conflict' })
    // The source is whole, with the file added meanwhile, and no half copy is left.
    const after = readFileSystem(aas.submodels[0]!, 'en')
    expect((findEntry(after, 'FOLDER_1700000000000') as FolderEntry).children.map(child => child.idShort)).toEqual(expect.arrayContaining(['Guide', 'Concurrent']))
    expect((findEntry(after, target) as FolderEntry).children).toEqual([])
  })

  it('moves what a folder holds now, not what the view showed', async () => {
    const { aas, studio, writer, entries, read } = setup()
    const manuals = findEntry(entries(), 'FOLDER_1700000000000')!
    // A file added after the view read the folder, with content of its own.
    const folder = await studio.client.aas.getElement(submodelId, 'FOLDER_1700000000000')
    await studio.client.aas.addElement({ submodelId, parentPath: 'FOLDER_1700000000000', element: { modelType: 'File', idShort: 'Late', contentType: 'text/plain' }, structureRevision: folder.structureRevision! })
    aas.setFile(submodelId, 'FOLDER_1700000000000.Late', { bytes: new TextEncoder().encode('late'), contentType: 'text/plain' })
    const target = await writer.createFolder('', 'Archive')
    const moved = await writer.move(manuals, target)
    // Its content is read and uploaded again: on BaSyx Go, content belongs to an element's path (ADR 0049).
    expect(studio.calls).toContainEqual({ method: 'studio.ui.readFile', params: { submodelId, idShortPath: 'FOLDER_1700000000000.Late' } })
    expect(studio.calls.some(call => call.method === 'studio.aas.putAttachment' && (call.params as { idShortPath: string }).idShortPath === `${moved}.Late`)).toBe(true)
    expect(await read(`${moved}.Late`)).toBe('late')
    expect(await read(`${moved}.Guide`)).toBe('%PDF-guide')
  })

  it('deletes files and folders, based on their current revision', async () => {
    const { writer, entries } = setup()
    await writer.delete(findEntry(entries(), 'FOLDER_1700000000000')!)
    await writer.delete(findEntry(entries(), 'zeta')!)
    expect(entries().map(entry => entry.name)).toEqual(['photo.png', 'spec.pdf'])
  })

  it('is refused outside edit mode, as Studio refuses it', async () => {
    const { writer, entries, studio } = setup()
    studio.setContext({ mode: 'view' })
    await expect(writer.delete(findEntry(entries(), 'zeta')!)).rejects.toMatchObject({ code: 'app_edit_mode_required' })
  })
})
