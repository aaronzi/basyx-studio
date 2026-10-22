import type { AppContext, JsonObject, ShellSummary, SubmodelSummary } from '@basyx/studio-sdk'
import type { TestStudio } from '@basyx/studio-sdk/testing'
import { createTestStudio, studioError } from '@basyx/studio-sdk/testing'
import manifest from '../../studio-app.json'

// A Studio in memory for `pnpm dev` and the unit tests: the app's data are
// these fixtures, and the calls are checked against the manifest's
// permissions as Studio checks them; the manifest also names the app and
// its module in the context.

const shells: ShellSummary[] = [
  { id: 'https://example.com/ids/aas/pump-01', idShort: 'Pump01', displayName: [{ language: 'en', text: 'Pump 01' }], assetKind: 'Instance', globalAssetId: 'https://example.com/ids/asset/pump-01' },
  { id: 'https://example.com/ids/aas/valve-07', idShort: 'Valve07', displayName: [], assetKind: 'Instance', globalAssetId: null },
]

const submodels: Record<string, SubmodelSummary[]> = {
  'https://example.com/ids/aas/pump-01': [
    { id: 'https://example.com/ids/sm/pump-01/models', idShort: 'Models3D', semanticId: 'https://admin-shell.io/idta/Models3D/1/0', status: 'available' },
    { id: 'https://example.com/ids/sm/pump-01/nameplate', idShort: 'Nameplate', semanticId: 'https://admin-shell.io/idta/nameplate/3/0/Nameplate', status: 'available' },
    { id: 'https://example.com/ids/sm/pump-01/private', idShort: null, semanticId: null, status: 'forbidden' },
  ],
  'https://example.com/ids/aas/valve-07': [],
}

const contents: Record<string, JsonObject> = {
  'https://example.com/ids/sm/pump-01/models': {
    modelType: 'Submodel',
    id: 'https://example.com/ids/sm/pump-01/models',
    idShort: 'Models3D',
    submodelElements: [
      {
        modelType: 'SubmodelElementCollection',
        idShort: 'Model01',
        value: [
          { modelType: 'File', idShort: 'ModelFile', contentType: 'application/x-step', value: '/aasx/files/pump.ifc' },
          { modelType: 'File', idShort: 'Preview', contentType: 'image/png', value: '/aasx/files/pump.png' },
        ],
      },
      { modelType: 'File', idShort: 'Casing', contentType: 'model/gltf-binary', value: 'casing.glb' },
    ],
  },
  'https://example.com/ids/sm/pump-01/nameplate': {
    modelType: 'Submodel',
    id: 'https://example.com/ids/sm/pump-01/nameplate',
    idShort: 'Nameplate',
    submodelElements: [{ modelType: 'Property', idShort: 'ManufacturerName', valueType: 'xs:string', value: 'Example Pumps' }],
  },
}

export function createDevStudio (context: Partial<AppContext> = {}): TestStudio {
  return createTestStudio({
    manifest,
    context: {
      target: { id: 'demo', name: 'Demo target', write: false, persistence: 'immediate' },
      ...context,
    },
    handlers: {
      'studio.aas.listShells': ({ limit = 50 }) => ({ items: shells.slice(0, limit), page: { nextCursor: null, hasMore: shells.length > limit } }),
      'studio.aas.listSubmodels': ({ shellId }) => {
        const items = submodels[shellId]
        if (!items) {
          throw studioError('target_resource_not_found', `No shell ${shellId}.`, 404)
        }
        return { items }
      },
      'studio.aas.getSubmodel': ({ submodelId }) => {
        const submodel = contents[submodelId]
        if (!submodel) {
          throw studioError('target_resource_not_found', `No submodel ${submodelId}.`, 404)
        }
        return submodel
      },
    },
  })
}
