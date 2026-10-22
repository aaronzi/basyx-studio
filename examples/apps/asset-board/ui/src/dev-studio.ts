import { createTestStudio, memoryAas } from '@basyx/studio-sdk/testing'

// The app without Studio: a test Studio with three shells and the settings
// an administrator would set for an infrastructure.

function shell (id: string, name: string, assetType: string, serial: string) {
  return {
    modelType: 'AssetAdministrationShell',
    id: `urn:example:aas:${id}`,
    idShort: name.replaceAll(' ', ''),
    displayName: [{ language: 'en', text: name }],
    assetInformation: { assetKind: 'Instance', globalAssetId: `urn:example:asset:${id}`, assetType, specificAssetIds: [{ name: 'serialNumber', value: serial }] },
  }
}

export function createDevStudio () {
  return createTestStudio({
    permissions: ['studio.aas.read', 'studio.ui.navigation'],
    context: { settings: { assetTypes: ['urn:example:type:pump'], serialIdName: 'serialNumber', pageSize: 25, showOthers: true } },
    handlers: memoryAas({
      shells: [
        shell('pump-1', 'Pump 1', 'urn:example:type:pump', 'P-0001'),
        shell('pump-2', 'Pump 2', 'urn:example:type:pump', 'P-0002'),
        shell('valve-1', 'Valve 1', 'urn:example:type:valve', 'V-0001'),
      ],
    }).handlers,
  })
}
