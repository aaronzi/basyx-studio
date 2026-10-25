import type { CopyDependencies } from '#shared/contract'
import type { JsonObject } from '~~/server/lib/aas/outline'
import type { AasTarget, BinaryContent } from '~~/server/lib/targets/aas-target'
import type { PackageFiles } from '~~/server/lib/workspaces/model'
import { describe, expect, it } from 'vitest'
import { toAasXml } from '~~/server/lib/aas/xml'
import { packagedFilePaths, rewriteReferences, semanticIdsOf } from '~~/server/lib/copies/content'
import { executeCopy, newCopyRun } from '~~/server/lib/copies/execute'
import { planCopy } from '~~/server/lib/copies/plan'
import { EnvironmentReader } from '~~/server/lib/copies/source'
import { parsePastedText } from '~~/server/lib/copies/text'
import { workspaceCapabilities } from '~~/server/lib/targets/capabilities'
import { WorkspaceModel } from '~~/server/lib/workspaces/model'
import { extractEnvironment, packEnvironment } from '~~/server/lib/workspaces/package'

const shellId = 'urn:test:aas:motor'
const nameplateId = 'urn:test:sm:nameplate'
const documentsId = 'urn:test:sm:documents'
const conceptId = 'urn:test:cd:serial'
const scheme = { type: 'uuid', prefix: '' } as const
const dependencies: CopyDependencies = { submodels: 'referenced', conceptDescriptions: 'referenced', supplementaryFiles: 'referenced' }
const noSync = { registry: false, submodelRegistry: false, discovery: false }

function environment (): JsonObject {
  return {
    assetAdministrationShells: [{
      modelType: 'AssetAdministrationShell',
      id: shellId,
      idShort: 'Motor',
      assetInformation: { assetKind: 'Instance', globalAssetId: 'urn:test:asset:motor' },
      submodels: [nameplateId, documentsId, 'urn:test:sm:missing'].map(value => ({ type: 'ModelReference', keys: [{ type: 'Submodel', value }] })),
    }],
    submodels: [
      {
        modelType: 'Submodel',
        id: nameplateId,
        idShort: 'Nameplate',
        submodelElements: [
          { modelType: 'Property', idShort: 'SerialNumber', valueType: 'xs:string', value: 'SN-1', semanticId: { type: 'ExternalReference', keys: [{ type: 'GlobalReference', value: conceptId }] } },
          { modelType: 'Property', idShort: 'Other', valueType: 'xs:string', semanticId: { type: 'ExternalReference', keys: [{ type: 'GlobalReference', value: 'urn:eclass:not-here' }] } },
          {
            modelType: 'ReferenceElement',
            idShort: 'SeeDocuments',
            value: { type: 'ModelReference', keys: [{ type: 'Submodel', value: documentsId }] },
          },
        ],
      },
      {
        modelType: 'Submodel',
        id: documentsId,
        idShort: 'Documents',
        submodelElements: [{
          modelType: 'SubmodelElementList',
          idShort: 'Files',
          typeValueListElement: 'File',
          value: [{ modelType: 'File', contentType: 'application/pdf', value: '/aasx/manual.pdf' }],
        }],
      },
    ],
    conceptDescriptions: [{ modelType: 'ConceptDescription', id: conceptId, idShort: 'SerialNumber' }],
  }
}

function memoryFiles (initial: Array<[string, BinaryContent]> = []): PackageFiles & { parts: Map<string, BinaryContent> } {
  const parts = new Map(initial)
  return {
    parts,
    read: async path => parts.get(path) ?? null,
    write: async (fileName, file) => {
      const path = `/aasx-suppl/${parts.size}/${fileName}`
      parts.set(path, file)
      return path
    },
    thumbnail: async () => null,
  }
}

const manual: BinaryContent = { bytes: new Uint8Array([1, 2, 3]), contentType: 'application/pdf', fileName: 'manual.pdf' }

/** A package as a target, as the copy reads and writes it in the worker. */
function targetOf (model: WorkspaceModel): AasTarget {
  return new Proxy({}, {
    get: (_, name: string) => {
      if (name === 'capabilities') {
        return workspaceCapabilities
      }
      if (name === 'registerShells' || name === 'registerSubmodels') {
        return async () => []
      }
      return async (...args: unknown[]) => (model as unknown as Record<string, (...a: unknown[]) => unknown>)[name]!(...args)
    },
  }) as AasTarget
}

function packages () {
  const sourceModel = new WorkspaceModel(environment(), memoryFiles([['/aasx/manual.pdf', manual]]))
  const destinationFiles = memoryFiles()
  const destinationModel = new WorkspaceModel({ assetAdministrationShells: [], submodels: [], conceptDescriptions: [] }, destinationFiles)
  return { source: targetOf(sourceModel), destination: targetOf(destinationModel), destinationModel, destinationFiles }
}

describe('copy content', () => {
  it('finds packaged files by path, including list items, and the semantic IDs of all elements', () => {
    const [nameplate, documents] = environment().submodels as JsonObject[]
    expect(packagedFilePaths(documents!)).toEqual(['Files[0]'])
    expect([...semanticIdsOf(nameplate)]).toEqual([conceptId, 'urn:eclass:not-here'])
  })

  it('rewrites references into the copied set only', () => {
    const nameplate = (environment().submodels as JsonObject[])[0]!
    const rewritten = rewriteReferences(nameplate, new Map([[documentsId, 'urn:new:documents']]))
    const elements = rewritten.submodelElements as JsonObject[]
    expect(elements[2]).toMatchObject({ value: { keys: [{ value: 'urn:new:documents' }] } })
    expect(elements[0]).toMatchObject({ semanticId: { keys: [{ value: conceptId }] } })
  })
})

describe('copy plans', () => {
  it('lists a shell with its submodels, the concept descriptions the source has and the files', async () => {
    const { source, destination } = packages()
    const plan = await planCopy({ reader: source, roots: [{ type: 'shell', id: shellId }], destination, dependencies, sameTarget: false })
    expect(plan.resources.map(resource => [resource.resourceType, resource.identifier, resource.role, resource.files])).toEqual([
      ['shell', shellId, 'root', 0],
      ['submodel', nameplateId, 'dependency', 0],
      ['submodel', documentsId, 'dependency', 1],
      ['submodel', 'urn:test:sm:missing', 'dependency', 0],
      ['conceptDescription', conceptId, 'dependency', 0],
    ])
    // A dangling reference cannot be read, and is left out.
    expect(plan.resources[3]!.blocked).toBeTruthy()
    expect(plan.resources.every(resource => !resource.exists)).toBe(true)
    expect(plan.defaultCollisionPolicy).toBe('fail_without_changes')
    expect(plan.allowedCollisionPolicies).toContain('replace')
  })

  it('leaves out the submodels and concepts the user did not ask for', async () => {
    const { source, destination } = packages()
    const plan = await planCopy({ reader: source, roots: [{ type: 'shell', id: shellId }], destination, dependencies: { ...dependencies, submodels: 'none', conceptDescriptions: 'none' }, sameTarget: false })
    expect(plan.resources.map(resource => resource.resourceType)).toEqual(['shell'])
  })
})

describe('copy execution', () => {
  it('copies a shell with its submodels, concept description and files into another package', async () => {
    const { source, destination, destinationModel, destinationFiles } = packages()
    const plan = await planCopy({ reader: source, roots: [{ type: 'shell', id: shellId }], destination, dependencies, sameTarget: false })
    const report = await executeCopy({ reader: source, destination, scheme, sync: noSync, dependencies, destinationShellId: null }, 'p1', plan.resources, 'fail_without_changes', new Set(), newCopyRun())

    expect(report.status).toBe('succeeded')
    expect(report.counts).toMatchObject({ planned: 4, created: 4, failed: 0 })
    // Concept descriptions first, then submodels, then the shell.
    expect(report.outcomes.map(outcome => outcome.resourceType)).toEqual(['conceptDescription', 'submodel', 'submodel', 'shell'])
    expect(destinationModel.shell(shellId).idShort).toBe('Motor')
    expect(destinationModel.conceptDescription(conceptId).idShort).toBe('SerialNumber')
    const copied = await destinationModel.attachment(documentsId, 'Files[0]')
    expect(copied.bytes).toEqual(manual.bytes)
    expect([...destinationFiles.parts.keys()]).toHaveLength(1)
    expect(report.shellKey).toBeTruthy()
  })

  it('refuses before writing when an identifier exists, and skips or replaces on request', async () => {
    const { source, destination, destinationModel } = packages()
    destinationModel.createSubmodel({ modelType: 'Submodel', id: nameplateId, idShort: 'OldNameplate' })
    const plan = await planCopy({ reader: source, roots: [{ type: 'shell', id: shellId }], destination, dependencies, sameTarget: false })
    expect(plan.resources.find(resource => resource.identifier === nameplateId)!.exists).toBe(true)
    expect(plan.defaultCollisionPolicy).toBe('skip_existing')
    const context = { reader: source, destination, scheme, sync: noSync, dependencies, destinationShellId: null }

    await expect(executeCopy(context, 'p1', plan.resources, 'fail_without_changes', new Set(), newCopyRun())).rejects.toMatchObject({ code: 'identifier_conflict' })
    expect(() => destinationModel.shell(shellId)).toThrow()

    const skipped = await executeCopy(context, 'p1', plan.resources, 'skip_existing', new Set(), newCopyRun())
    expect(skipped.outcomes.find(outcome => outcome.identifier === nameplateId)).toMatchObject({ status: 'skipped' })
    expect(destinationModel.submodel(nameplateId).idShort).toBe('OldNameplate')

    const replaced = await executeCopy(context, 'p2', plan.resources, 'replace', new Set(), newCopyRun())
    expect(replaced.outcomes.find(outcome => outcome.identifier === nameplateId)).toMatchObject({ status: 'replaced' })
    expect(destinationModel.submodel(nameplateId).idShort).toBe('Nameplate')
  })

  it('gives copies in the same package new identifiers and points the references at them', async () => {
    const files = memoryFiles([['/aasx/manual.pdf', manual]])
    const model = new WorkspaceModel(environment(), files)
    const target = targetOf(model)
    const plan = await planCopy({ reader: target, roots: [{ type: 'shell', id: shellId }], destination: target, dependencies, sameTarget: true })
    expect(plan.defaultCollisionPolicy).toBe('new_identifiers')
    expect(plan.allowedCollisionPolicies).not.toContain('replace')
    const report = await executeCopy({ reader: target, destination: target, scheme, sync: noSync, dependencies, destinationShellId: null }, 'p1', plan.resources, 'new_identifiers', new Set(), newCopyRun())

    const byId = new Map(report.outcomes.map(outcome => [outcome.identifier, outcome]))
    // The concept keeps its identifier and exists already.
    expect(byId.get(conceptId)).toMatchObject({ status: 'skipped', destinationIdentifier: conceptId })
    const newShell = model.shell(byId.get(shellId)!.destinationIdentifier)
    const newNameplate = byId.get(nameplateId)!.destinationIdentifier
    const newDocuments = byId.get(documentsId)!.destinationIdentifier
    expect(newNameplate).toMatch(/^urn:uuid:/)
    expect((newShell.submodels as JsonObject[]).map(reference => (reference.keys as JsonObject[])[0]!.value)).toEqual([newNameplate, newDocuments, 'urn:test:sm:missing'])
    expect(model.submodel(newNameplate).submodelElements).toContainEqual(expect.objectContaining({ idShort: 'SeeDocuments', value: { type: 'ModelReference', keys: [{ type: 'Submodel', value: newDocuments }] } }))
    // The original stays as it was (DATA-014).
    expect(model.shell(shellId).submodels).toEqual((environment().assetAdministrationShells as JsonObject[])[0]!.submodels)
  })

  it('skips on a second run what the first run wrote, with the same identifiers (DATA-015)', async () => {
    const { source, destination, destinationModel } = packages()
    const plan = await planCopy({ reader: source, roots: [{ type: 'shell', id: shellId }], destination, dependencies, sameTarget: false })
    const run = newCopyRun()
    const context = { reader: source, destination, scheme, sync: noSync, dependencies, destinationShellId: null }
    const first = await executeCopy(context, 'p1', plan.resources, 'new_identifiers', new Set(), run)
    const second = await executeCopy(context, 'p1', plan.resources, 'new_identifiers', new Set(), run)
    expect(second.counts).toMatchObject({ created: 0, skipped: 4 })
    expect(second.outcomes.map(outcome => outcome.destinationIdentifier)).toEqual(first.outcomes.map(outcome => outcome.destinationIdentifier))
    expect(destinationModel.listShells(10, undefined).items).toHaveLength(1)
  })

  it('references a pasted submodel from the destination shell and leaves out excluded resources', async () => {
    const { source, destination, destinationModel } = packages()
    destinationModel.createShell({ modelType: 'AssetAdministrationShell', id: 'urn:test:aas:line', assetInformation: { assetKind: 'Instance', globalAssetId: 'urn:test:asset:line' } })
    const plan = await planCopy({ reader: source, roots: [{ type: 'submodel', id: nameplateId }], destination, dependencies, sameTarget: false })
    const concept = plan.resources.find(resource => resource.resourceType === 'conceptDescription')!
    const report = await executeCopy({ reader: source, destination, scheme, sync: noSync, dependencies, destinationShellId: 'urn:test:aas:line' }, 'p1', plan.resources, 'fail_without_changes', new Set([concept.key]), newCopyRun())
    expect(report.outcomes.map(outcome => outcome.resourceType)).toEqual(['submodel'])
    expect(destinationModel.submodelIds('urn:test:aas:line')).toEqual([nameplateId])
    expect(() => destinationModel.conceptDescription(conceptId)).toThrow()
  })
})

describe('pasted text', () => {
  it('takes an environment, or a single submodel in JSON or XML', async () => {
    expect(parsePastedText('json', JSON.stringify(environment())).label).toBe('Pasted environment')
    const submodel = (environment().submodels as JsonObject[])[0]!
    const fromJson = parsePastedText('json', JSON.stringify(submodel))
    expect(new EnvironmentReader(fromJson.environment).submodels.map(item => item.id)).toEqual([nameplateId])
    const fromXml = parsePastedText('xml', toAasXml(submodel, 'submodel'))
    expect(await new EnvironmentReader(fromXml.environment).submodel(nameplateId)).toMatchObject({ idShort: 'Nameplate' })
  })

  it('sends submodel elements to the tree', () => {
    expect(() => parsePastedText('json', JSON.stringify({ modelType: 'Property', idShort: 'A', valueType: 'xs:string' }))).toThrow(/element tree/)
    expect(() => parsePastedText('json', '{')).toThrow(/not valid JSON/)
  })
})

describe('packages of copied content', () => {
  it('packs an environment with its files and extracts both again', async () => {
    const bytes = await packEnvironment(environment(), [{ path: '/aasx/manual.pdf', contentType: 'application/pdf', bytes: manual.bytes }])
    const extracted = await extractEnvironment(bytes, 'aasx')
    expect((extracted.environment.assetAdministrationShells as JsonObject[])[0]!.id).toBe(shellId)
    expect(extracted.files).toEqual([{ path: '/aasx/manual.pdf', contentType: 'application/pdf', bytes: manual.bytes }])
    const reader = new EnvironmentReader(extracted.environment, extracted.files)
    expect((await reader.attachment(documentsId, 'Files[0]')).bytes).toEqual(manual.bytes)
  })
})
