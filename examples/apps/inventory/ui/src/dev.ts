import type { AppContext, JsonObject } from '@basyx/studio-sdk'
import type { TestStudio } from '@basyx/studio-sdk/testing'
import { createTestStudio, memoryAas } from '@basyx/studio-sdk/testing'
import manifest from '../../studio-app.json'

// A Studio in memory for `pnpm dev`: a few shells of a hall and its
// equipment, one with an IFC model, checked against the manifest as
// Studio checks the calls. Production builds leave it out.

const reference = (id: string) => ({ type: 'ModelReference', keys: [{ type: 'Submodel', value: id }] })

function shell (key: string, name: string, assetKind: 'Instance' | 'Type', submodels: string[] = []): JsonObject {
  return {
    modelType: 'AssetAdministrationShell',
    id: `https://example.com/ids/aas/${key}`,
    idShort: key,
    displayName: [{ language: 'en', text: name }, { language: 'de', text: name }],
    assetInformation: { assetKind, globalAssetId: `https://example.com/ids/asset/${key}` },
    submodels: submodels.map(id => reference(id)),
  }
}

const building = 'https://example.com/ids/sm/hall-a/building'
const nameplate = 'https://example.com/ids/sm/hall-a/nameplate'

const shells = [
  shell('hall-a', 'Hall A', 'Instance', [building, nameplate]),
  ...Array.from({ length: 12 }, (_, index) => shell(`pump-${index + 1}`, `Pump ${index + 1}`, 'Instance')),
  shell('pump-type', 'Pump type', 'Type'),
]

const submodels: JsonObject[] = [
  {
    modelType: 'Submodel',
    id: building,
    idShort: 'BuildingModel',
    submodelElements: [{ modelType: 'File', idShort: 'Model', contentType: 'application/x-step', value: '/aasx/files/hall-a.ifc' }],
  },
  {
    modelType: 'Submodel',
    id: nameplate,
    idShort: 'Nameplate',
    semanticId: { type: 'ExternalReference', keys: [{ type: 'GlobalReference', value: 'https://admin-shell.io/idta/nameplate/3/0/Nameplate' }] },
    submodelElements: [{ modelType: 'Property', idShort: 'ManufacturerName', valueType: 'xs:string', value: 'Example Halls' }],
  },
]

/** `ifc`: the bytes of the hall's IFC model. */
export function createDevStudio (context: Partial<AppContext> = {}, ifc?: Uint8Array): TestStudio {
  const aas = memoryAas({ shells, submodels })
  if (ifc) {
    aas.setFile(building, 'Model', { bytes: ifc, contentType: 'application/x-step' })
  }
  return createTestStudio({
    manifest,
    context: { target: { id: 'demo', name: 'Demo target', write: false, persistence: 'immediate' }, ...context },
    handlers: aas.handlers,
  })
}
