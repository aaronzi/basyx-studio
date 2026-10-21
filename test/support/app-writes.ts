import type { Methods } from '@basyx/studio-sdk/protocol'
import type { JsonObject } from '~~/server/lib/aas/outline'
import type { AasCallContext, AasMethodName } from '~~/server/lib/apps/calls'
import { expect, it } from 'vitest'
import { executeAasMethod } from '~~/server/lib/apps/calls'

// The contract of the structural app methods (MVP-7 A1, A2), per method, for
// any target: a live infrastructure in test/integration, a workspace in
// test/apps. Each run creates its own shell and removes it again.

const folderSemanticId = { type: 'ExternalReference', keys: [{ type: 'GlobalReference', value: 'https://basyx.org/submodels/Folder' }] }

export interface AppWritesTarget {
  context: AasCallContext
  /** What a fresh shell's identifiers must look like, from the target's ID scheme. */
  idPattern: RegExp
  /** Registers what a test created, so it is removed even when the test fails. */
  created: { shells: string[], submodels: string[] }
}

export function appWritesContract (open: () => AppWritesTarget): void {
  // Parameters as Studio's schemas pass them on, with their defaults.
  const call = <M extends AasMethodName>(target: AppWritesTarget, method: M, params: Methods[M]['params']): Promise<Methods[M]['result']> =>
    executeAasMethod(target.context, method, params)

  /** A shell with an empty FileSystem-like submodel, created through the app methods. */
  async function fileSystem (target: AppWritesTarget) {
    const { shell, steps } = await call(target, 'studio.aas.createShell', {
      shell: { idShort: 'AppWritesShell' },
      submodels: [{ idShort: 'Files', semanticId: { type: 'ExternalReference', keys: [{ type: 'GlobalReference', value: 'https://basyx.org/FileSystem/FileSystem/0/1' }] } }],
    })
    const shellId = String(shell.id)
    const submodelId = steps.find(step => step.resource === 'submodel')!.id
    target.created.shells.push(shellId)
    target.created.submodels.push(submodelId)
    return { shell, shellId, submodelId, steps }
  }

  it('createShell generates identifiers by the scheme and writes submodels first', async () => {
    const target = open()
    const { shell, shellId, submodelId, steps } = await fileSystem(target)
    expect(shellId).toMatch(target.idPattern)
    expect(submodelId).toMatch(target.idPattern)
    expect(steps.slice(0, 2).map(step => [step.resource, step.outcome])).toEqual([['submodel', 'written'], ['shell', 'written']])
    expect(shell.submodels).toEqual([{ type: 'ModelReference', keys: [{ type: 'Submodel', value: submodelId }] }])
    await expect(call(target, 'studio.aas.createShell', { shell: { id: shellId, idShort: 'Again' }, submodels: [] }))
      .rejects
      .toMatchObject({ code: 'identifier_conflict' })
    // AAS Core findings come back as violations, before anything is written.
    await expect(call(target, 'studio.aas.createShell', { shell: { idShort: '1 invalid' }, submodels: [] }))
      .rejects
      .toMatchObject({ code: 'validation_failed', violations: expect.any(Array) })
  })

  it('createSubmodel adds a submodel to a shell, or on its own', async () => {
    const target = open()
    const { shellId } = await fileSystem(target)
    const referenced = await call(target, 'studio.aas.createSubmodel', { shellId, submodel: { idShort: 'Notes' } })
    target.created.submodels.push(referenced.submodelId)
    expect(referenced.steps.map(step => step.resource)).toContain('submodelReference')
    const listed = await call(target, 'studio.aas.listSubmodels', { shellId })
    expect(listed.items.map(item => item.id)).toContain(referenced.submodelId)

    const alone = await call(target, 'studio.aas.createSubmodel', { submodel: { id: `${referenced.submodelId}-alone`, idShort: 'Alone' } })
    target.created.submodels.push(alone.submodelId)
    expect(alone.submodelId).toBe(`${referenced.submodelId}-alone`)
    await expect(call(target, 'studio.aas.createSubmodel', { submodel: { id: alone.submodelId, idShort: 'Twice' } }))
      .rejects
      .toMatchObject({ code: 'identifier_conflict' })
  })

  it('addElement, putElement and deleteElement keep revisions as the editor does', async () => {
    const target = open()
    const { submodelId } = await fileSystem(target)
    const top = await call(target, 'studio.aas.getSubmodelSnapshot', { submodelId })
    const folder = await call(target, 'studio.aas.addElement', {
      submodelId,
      element: { modelType: 'SubmodelElementCollection', idShort: 'FOLDER_1', displayName: [{ language: 'en', text: 'Manuals' }], semanticId: folderSemanticId },
      structureRevision: top.structureRevision,
    })
    expect(folder.idShortPath).toBe('FOLDER_1')
    expect(folder.structureRevision).toMatch(/^s\./)
    // The same structure revision again: someone added an element meanwhile.
    await expect(call(target, 'studio.aas.addElement', { submodelId, element: { modelType: 'SubmodelElementCollection', idShort: 'FOLDER_2' }, structureRevision: top.structureRevision }))
      .rejects
      .toMatchObject({ code: 'structure_conflict' })

    const file = await call(target, 'studio.aas.addElement', {
      submodelId,
      parentPath: 'FOLDER_1',
      element: { modelType: 'File', idShort: 'Guide', contentType: 'text/plain' },
      structureRevision: folder.structureRevision!,
    })
    expect(file.idShortPath).toBe('FOLDER_1.Guide')
    expect(file.structureRevision).toBeNull()
    const duplicate = await call(target, 'studio.aas.getElement', { submodelId, idShortPath: 'FOLDER_1' })
    await expect(call(target, 'studio.aas.addElement', { submodelId, parentPath: 'FOLDER_1', element: { modelType: 'File', idShort: 'Guide', contentType: 'text/plain' }, structureRevision: duplicate.structureRevision! }))
      .rejects
      .toMatchObject({ code: 'idshort_conflict' })
    await expect(call(target, 'studio.aas.addElement', { submodelId, parentPath: 'FOLDER_1', element: { modelType: 'Property', idShort: 'NoType' }, structureRevision: duplicate.structureRevision! }))
      .rejects
      .toMatchObject({ code: 'validation_failed' })

    // A rename keeps the folder's children (W1).
    const renamed = await call(target, 'studio.aas.putElement', {
      submodelId,
      idShortPath: 'FOLDER_1',
      element: { ...duplicate.value, idShort: 'FOLDER_9', displayName: [{ language: 'en', text: 'Handbooks' }], value: undefined },
      revision: duplicate.revision,
    })
    expect(renamed.idShortPath).toBe('FOLDER_9')
    expect((renamed.value.value as JsonObject[]).map(child => child.idShort)).toEqual(['Guide'])
    expect(renamed.value.displayName).toEqual([{ language: 'en', text: 'Handbooks' }])
    await expect(call(target, 'studio.aas.putElement', { submodelId, idShortPath: 'FOLDER_9', element: { ...renamed.value, modelType: 'Property' }, revision: renamed.revision }))
      .rejects
      .toMatchObject({ code: 'validation_failed' })

    await expect(call(target, 'studio.aas.deleteElement', { submodelId, idShortPath: 'FOLDER_9', revision: duplicate.revision }))
      .rejects
      .toMatchObject({ code: 'revision_conflict' })
    await call(target, 'studio.aas.deleteElement', { submodelId, idShortPath: 'FOLDER_9', revision: renamed.revision })
    await expect(call(target, 'studio.aas.getElement', { submodelId, idShortPath: 'FOLDER_9' })).rejects.toMatchObject({ code: 'target_resource_not_found' })
  })

  it('putAttachment replaces a File\'s content, based on its revision', async () => {
    const target = open()
    const { submodelId } = await fileSystem(target)
    const top = await call(target, 'studio.aas.getSubmodelSnapshot', { submodelId })
    const file = await call(target, 'studio.aas.addElement', { submodelId, element: { modelType: 'File', idShort: 'Readme', contentType: 'text/plain' }, structureRevision: top.structureRevision })
    const bytes = new TextEncoder().encode('Hello from an app')
    const written = await call(target, 'studio.aas.putAttachment', { submodelId, idShortPath: 'Readme', fileName: 'readme.txt', contentType: 'text/plain', data: bytes, revision: file.revision })
    expect(written.value).toMatchObject({ modelType: 'File', contentType: 'text/plain' })
    expect(written.revision).not.toBe(file.revision)
    const read = await target.context.target.attachment(submodelId, 'Readme')
    expect(new TextDecoder().decode(read.bytes)).toBe('Hello from an app')
    await expect(call(target, 'studio.aas.putAttachment', { submodelId, idShortPath: 'Readme', fileName: 'readme.txt', contentType: 'text/plain', data: bytes, revision: file.revision }))
      .rejects
      .toMatchObject({ code: 'revision_conflict' })
  })

  it('putSubmodel replaces the whole submodel, based on the snapshot\'s revision', async () => {
    const target = open()
    const { submodelId } = await fileSystem(target)
    const before = await call(target, 'studio.aas.getSubmodelSnapshot', { submodelId })
    const next = { ...before.submodel, submodelElements: [{ modelType: 'Property', idShort: 'Version', valueType: 'xs:string', value: '2' }] }
    const after = await call(target, 'studio.aas.putSubmodel', { submodelId, submodel: next, revision: before.revision })
    expect((after.submodel.submodelElements as JsonObject[]).map(element => element.idShort)).toEqual(['Version'])
    expect(after.revision).not.toBe(before.revision)
    await expect(call(target, 'studio.aas.putSubmodel', { submodelId, submodel: next, revision: before.revision }))
      .rejects
      .toMatchObject({ code: 'revision_conflict' })
    await expect(call(target, 'studio.aas.putSubmodel', { submodelId, submodel: { ...next, id: `${submodelId}-other` }, revision: after.revision }))
      .rejects
      .toMatchObject({ code: 'validation_failed' })
  })

  it('deleteSubmodel removes references first, and deleteShell its submodels on request', async () => {
    const target = open()
    const { shellId, submodelId } = await fileSystem(target)
    const extra = await call(target, 'studio.aas.createSubmodel', { shellId, submodel: { idShort: 'Extra' } })
    target.created.submodels.push(extra.submodelId)

    const removed = await call(target, 'studio.aas.deleteSubmodel', { submodelId: extra.submodelId, removeReferences: true })
    expect(removed.steps.map(step => [step.resource, step.outcome])).toContainEqual(['submodel', 'written'])
    expect((await call(target, 'studio.aas.listSubmodels', { shellId })).items.map(item => item.id)).toEqual([submodelId])

    const deleted = await call(target, 'studio.aas.deleteShell', { shellId, deleteSubmodels: true })
    expect(deleted.steps.map(step => [step.resource, step.id, step.outcome])).toEqual(expect.arrayContaining([['shell', shellId, 'removed'], ['submodel', submodelId, 'removed']]))
    await expect(call(target, 'studio.aas.getShell', { shellId })).rejects.toMatchObject({ code: 'target_resource_not_found' })
    await expect(call(target, 'studio.aas.getSubmodel', { submodelId })).rejects.toMatchObject({ code: 'target_resource_not_found' })
  })
}
