import type { SubmodelOwners } from '#shared/contract'
import { decodeKey } from '~~/server/lib/aas/keys'
import { defineStudioHandler, routeParam } from '~~/server/utils/handler'
import { openTarget } from '~~/server/utils/target'

/** The shells that reference a submodel (the submodel view's header and delete dialog). */
export default defineStudioHandler(async (event): Promise<SubmodelOwners> => {
  const key = routeParam(event, 'submodelKey')
  const submodelId = decodeKey(key, 'submodel key')
  const { target } = await openTarget(event)
  const { shells, ...result } = await target.submodelOwners([submodelId])
  return { items: [{ key, shells: shells[submodelId] ?? [] }], ...result }
})
