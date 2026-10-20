import type { SubmodelOwners } from '#shared/contract'
import { decodeKey } from '~~/server/lib/aas/keys'
import { defineStudioHandler, readValidated } from '~~/server/utils/handler'
import { openTarget } from '~~/server/utils/target'
import { submodelOwnersRequestSchema } from '#shared/contract'

/**
 * The shells that reference the listed submodels; the submodel list asks
 * for its loaded rows to mark orphans. A POST because the keys can be long.
 */
export default defineStudioHandler(async (event): Promise<SubmodelOwners> => {
  const { keys } = await readValidated(event, submodelOwnersRequestSchema)
  const ids = keys.map(key => decodeKey(key, 'submodel key'))
  const { target } = await openTarget(event)
  const { shells, ...result } = await target.submodelOwners(ids)
  return { items: keys.map((key, index) => ({ key, shells: shells[ids[index]!] ?? [] })), ...result }
})
