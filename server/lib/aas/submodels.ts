import type { ShellSummary, SubmodelAdministration, SubmodelSummary } from '#shared/contract'
import type { JsonObject } from './outline'
import { encodeKey } from './keys'
import { firstKeyValue } from './outline'
import { langStrings } from './shells'

/** Version, revision and template ID of a submodel's `administration`, or `null` without any. */
export function administrationOf (value: unknown): SubmodelAdministration | null {
  if (typeof value !== 'object' || value === null) {
    return null
  }
  const record = value as Record<string, unknown>
  const text = (field: string) => typeof record[field] === 'string' && record[field] !== '' ? record[field] as string : null
  const administration = { version: text('version'), revision: text('revision'), templateId: text('templateId') }
  return administration.version || administration.revision || administration.templateId ? administration : null
}

/**
 * The list entry of a submodel (AAS JSON, with or without its elements) or
 * of its registry descriptor, which carries the same fields but no kind.
 */
export function toSubmodelSummary (submodel: JsonObject): SubmodelSummary {
  return {
    key: encodeKey(String(submodel.id)),
    id: String(submodel.id),
    idShort: typeof submodel.idShort === 'string' ? submodel.idShort : null,
    displayName: langStrings(submodel.displayName),
    description: langStrings(submodel.description),
    kind: typeof submodel.kind === 'string' ? submodel.kind : null,
    semanticId: firstKeyValue(submodel.semanticId),
    administration: administrationOf(submodel.administration),
  }
}

/** The shells among `shells` that reference each submodel, by submodel ID; each shell once. */
export function ownersOf (submodelIds: readonly string[], shells: ReadonlyArray<{ summary: ShellSummary, submodelIds: string[] }>): Record<string, ShellSummary[]> {
  const owners: Record<string, ShellSummary[]> = Object.fromEntries(submodelIds.map(id => [id, []]))
  for (const { summary, submodelIds: references } of shells) {
    for (const id of new Set(references)) {
      if (owners[id] && !owners[id].some(shell => shell.id === summary.id)) {
        owners[id].push(summary)
      }
    }
  }
  return owners
}
