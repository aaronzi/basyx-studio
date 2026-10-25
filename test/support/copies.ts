import type { JsonObject } from '~~/server/lib/aas/outline'
import type { AasTarget, BinaryContent } from '~~/server/lib/targets/aas-target'
import type { PackageFiles, WorkspaceModel } from '~~/server/lib/workspaces/model'
import { workspaceCapabilities } from '~~/server/lib/targets/capabilities'

// A small package for copy tests: a shell with two submodels and a dangling
// reference, a File in a list, a concept description its semantic IDs name.

export function copyIds (prefix = 'urn:test') {
  return {
    shellId: `${prefix}:aas:motor`,
    nameplateId: `${prefix}:sm:nameplate`,
    documentsId: `${prefix}:sm:documents`,
    conceptId: `${prefix}:cd:serial`,
  }
}

export function copyEnvironment (prefix = 'urn:test'): JsonObject {
  const { shellId, nameplateId, documentsId, conceptId } = copyIds(prefix)
  return {
    assetAdministrationShells: [{
      modelType: 'AssetAdministrationShell',
      id: shellId,
      idShort: 'Motor',
      assetInformation: { assetKind: 'Instance', globalAssetId: `${prefix}:asset:motor` },
      submodels: [nameplateId, documentsId, `${prefix}:sm:missing`].map(value => ({ type: 'ModelReference', keys: [{ type: 'Submodel', value }] })),
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

export const manual: BinaryContent = { bytes: new Uint8Array([1, 2, 3]), contentType: 'application/pdf', fileName: 'manual.pdf' }

export function memoryFiles (initial: Array<[string, BinaryContent]> = []): PackageFiles & { parts: Map<string, BinaryContent> } {
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

/** A package as a target, as the copy reads and writes it in the worker. */
export function packageTarget (model: WorkspaceModel): AasTarget {
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
