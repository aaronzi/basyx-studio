import { putAttachmentMaxBytes } from '@basyx/studio-sdk'
import { createTestStudio, memoryAas } from '@basyx/studio-sdk/testing'
import { describe, expect, it } from 'vitest'

// Structural writes and attachments in the test Studio (MVP-7 A1, A2): the
// refusals Studio's server makes, and AAS content in memory with revisions.

const submodelId = 'urn:example:sm:files'
function files () {
  return memoryAas({
    shells: [{ modelType: 'AssetAdministrationShell', id: 'urn:example:shell', idShort: 'Pump', submodels: [{ type: 'ModelReference', keys: [{ type: 'Submodel', value: submodelId }] }] }],
    submodels: [{ modelType: 'Submodel', id: submodelId, idShort: 'Files', submodelElements: [] }],
  })
}

describe('the test Studio', () => {
  it('refuses structural writes outside edit mode, as Studio\'s server does', async () => {
    const studio = createTestStudio({ handlers: files().handlers })
    const snapshot = await studio.client.aas.getSubmodelSnapshot(submodelId)
    await expect(studio.client.aas.addElement({ submodelId, element: { modelType: 'File', idShort: 'A' }, structureRevision: snapshot.structureRevision }))
      .rejects
      .toMatchObject({ code: 'app_edit_mode_required', problem: { status: 403 } })
    studio.setContext({ mode: 'edit' })
    await expect(studio.client.aas.addElement({ submodelId, element: { modelType: 'File', idShort: 'A' }, structureRevision: snapshot.structureRevision }))
      .resolves
      .toMatchObject({ idShortPath: 'A' })
  })

  it('refuses attachments above 8 MiB', async () => {
    const studio = createTestStudio({ handlers: files().handlers, context: { mode: 'edit' } })
    await expect(studio.client.aas.putAttachment({ submodelId, idShortPath: 'A', fileName: 'a.bin', contentType: 'application/octet-stream', data: new Uint8Array(putAttachmentMaxBytes + 1), revision: 'h.x' }))
      .rejects
      .toMatchObject({ code: 'invalid_request' })
  })
})

describe('memoryAas', () => {
  it('adds, renames, uploads, reads and deletes with revisions and conflicts', async () => {
    const aas = files()
    const { client } = createTestStudio({ handlers: aas.handlers, context: { mode: 'edit' } })
    const top = await client.aas.getSubmodelSnapshot(submodelId)
    const folder = await client.aas.addElement({ submodelId, element: { modelType: 'SubmodelElementCollection', idShort: 'FOLDER_1' }, structureRevision: top.structureRevision })
    await expect(client.aas.addElement({ submodelId, element: { modelType: 'File', idShort: 'B' }, structureRevision: top.structureRevision }))
      .rejects
      .toMatchObject({ code: 'structure_conflict' })
    const file = await client.aas.addElement({ submodelId, parentPath: 'FOLDER_1', element: { modelType: 'File', idShort: 'Readme', contentType: 'text/plain' }, structureRevision: folder.structureRevision! })
    expect(file.idShortPath).toBe('FOLDER_1.Readme')

    const uploaded = await client.aas.putAttachment({ submodelId, idShortPath: file.idShortPath, fileName: 'readme.txt', contentType: 'text/plain', data: new TextEncoder().encode('hello'), revision: file.revision })
    await expect(client.aas.putAttachment({ submodelId, idShortPath: file.idShortPath, fileName: 'readme.txt', contentType: 'text/plain', data: new TextEncoder().encode('again'), revision: file.revision }))
      .rejects
      .toMatchObject({ code: 'revision_conflict' })

    // Content follows its element through a rename.
    const renamed = await client.aas.putElement({ submodelId, idShortPath: file.idShortPath, element: { ...uploaded.value, idShort: 'Guide' }, revision: uploaded.revision })
    expect(renamed.idShortPath).toBe('FOLDER_1.Guide')
    const read = await client.ui.readFile(submodelId, 'FOLDER_1.Guide')
    expect(new TextDecoder().decode(read.bytes)).toBe('hello')

    const parent = await client.aas.getElement(submodelId, 'FOLDER_1')
    const renamedFolder = await client.aas.putElement({ submodelId, idShortPath: 'FOLDER_1', element: { modelType: 'SubmodelElementCollection', idShort: 'FOLDER_1', displayName: [{ language: 'en', text: 'Docs' }] }, revision: parent.revision })
    expect(renamedFolder.value.value).toHaveLength(1)

    await expect(client.aas.deleteElement({ submodelId, idShortPath: 'FOLDER_1', revision: parent.revision })).rejects.toMatchObject({ code: 'revision_conflict' })
    await client.aas.deleteElement({ submodelId, idShortPath: 'FOLDER_1', revision: renamedFolder.revision })
    expect(aas.submodels[0]!.submodelElements).toEqual([])
  })

  it('hands out revisions that reads do not change', async () => {
    // An empty submodel and an empty folder: reading them must not add `[]`.
    const aas = memoryAas({ submodels: [{ modelType: 'Submodel', id: submodelId, idShort: 'Files' }] })
    const { client } = createTestStudio({ handlers: aas.handlers, context: { mode: 'edit' } })
    const empty = await client.aas.getSubmodelSnapshot(submodelId)
    await expect(client.aas.putSubmodel({ submodelId, submodel: empty.submodel, revision: empty.revision })).resolves.toMatchObject({ submodel: { id: submodelId } })

    const top = await client.aas.getSubmodelSnapshot(submodelId)
    const folder = await client.aas.addElement({ submodelId, element: { modelType: 'SubmodelElementCollection', idShort: 'Empty' }, structureRevision: top.structureRevision })
    expect(await client.aas.getElement(submodelId, 'Empty')).toMatchObject({ revision: folder.revision })
    await expect(client.aas.deleteElement({ submodelId, idShortPath: 'Empty', revision: folder.revision })).resolves.toBeNull()
    expect(aas.submodels[0]!.submodelElements).toEqual([])
  })

  it('keeps attachments of Files whose value a replaced submodel keeps', async () => {
    const aas = memoryAas({ submodels: [{ modelType: 'Submodel', id: submodelId, idShort: 'Files', submodelElements: [{ modelType: 'File', idShort: 'Manual', contentType: 'text/plain' }] }] })
    aas.setFile(submodelId, 'Manual', { bytes: new TextEncoder().encode('hello'), contentType: 'text/plain' })
    const { client } = createTestStudio({ handlers: aas.handlers, context: { mode: 'edit' } })
    expect(new TextDecoder().decode((await client.ui.readFile(submodelId, 'Manual')).bytes)).toBe('hello')
    const snapshot = await client.aas.getSubmodelSnapshot(submodelId)
    await client.aas.putSubmodel({ submodelId, submodel: snapshot.submodel, revision: snapshot.revision })
    expect(new TextDecoder().decode((await client.ui.readFile(submodelId, 'Manual')).bytes)).toBe('hello')

    // A File without value has no content.
    const next = await client.aas.getSubmodelSnapshot(submodelId)
    await client.aas.putSubmodel({ submodelId, submodel: { ...next.submodel, submodelElements: [{ modelType: 'File', idShort: 'Manual', contentType: 'text/plain' }] }, revision: next.revision })
    await expect(client.ui.readFile(submodelId, 'Manual')).rejects.toMatchObject({ code: 'target_resource_not_found' })
  })

  it('creates and deletes shells and submodels', async () => {
    const aas = files()
    const { client } = createTestStudio({ handlers: aas.handlers, context: { mode: 'edit' } })
    const { shell, steps } = await client.aas.createShell({ shell: { idShort: 'New' }, submodels: [{ idShort: 'Notes' }] })
    expect(steps.map(step => step.resource)).toEqual(['submodel', 'shell'])
    const { submodelId: extra } = await client.aas.createSubmodel({ shellId: String(shell.id), submodel: { idShort: 'Extra' } })
    expect((await client.aas.listSubmodels(String(shell.id))).items.map(item => item.idShort)).toEqual(['Notes', 'Extra'])
    await client.aas.deleteSubmodel({ submodelId: extra, removeReferences: true })
    expect((await client.aas.listSubmodels(String(shell.id))).items).toHaveLength(1)
    await client.aas.deleteShell({ shellId: String(shell.id), deleteSubmodels: true })
    expect(aas.shells.map(item => item.idShort)).toEqual(['Pump'])
    expect(aas.submodels.map(item => item.idShort)).toEqual(['Files'])
  })
})
