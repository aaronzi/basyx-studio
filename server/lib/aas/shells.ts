import type { ShellSummary } from '#shared/contract'
import type { JsonObject } from './outline'
import { encodeKey } from './keys'

function langStrings (value: unknown): Array<{ language: string, text: string }> {
  return Array.isArray(value)
    ? value.filter((entry): entry is { language: string, text: string } => typeof entry?.language === 'string' && typeof entry?.text === 'string')
    : []
}

export function toShellSummary (shell: JsonObject): ShellSummary {
  const assetInformation = (shell.assetInformation ?? {}) as JsonObject
  return {
    key: encodeKey(String(shell.id)),
    id: String(shell.id),
    idShort: typeof shell.idShort === 'string' ? shell.idShort : null,
    displayName: langStrings(shell.displayName),
    description: langStrings(shell.description),
    assetKind: typeof assetInformation.assetKind === 'string' ? assetInformation.assetKind : null,
    globalAssetId: typeof assetInformation.globalAssetId === 'string' ? assetInformation.globalAssetId : null,
  }
}

/** The submodel identifier of a submodel reference (`ModelReference` to a `Submodel`). */
export function submodelIdOf (reference: JsonObject): string | null {
  const keys = Array.isArray(reference.keys) ? reference.keys as JsonObject[] : []
  const key = keys.findLast(entry => entry.type === 'Submodel') ?? keys[0]
  return typeof key?.value === 'string' ? key.value : null
}
