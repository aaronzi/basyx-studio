import type { SubmodelTree } from '#shared/contract'
import { decodeKey } from '~~/server/lib/aas/keys'
import { buildSubmodelTree } from '~~/server/lib/aas/tree'
import { defineStudioHandler, queryValidated, routeParam } from '~~/server/utils/handler'
import { openTarget, requireCapability } from '~~/server/utils/target'
import { submodelTreeQuerySchema } from '#shared/contract'

/** The whole element tree of a submodel, now or (with `at`) as it was at a point in time. */
export default defineStudioHandler(async (event): Promise<SubmodelTree> => {
  const submodelId = decodeKey(routeParam(event, 'submodelKey'), 'submodel key')
  const { at } = queryValidated(event, submodelTreeQuerySchema)
  const opened = await openTarget(event)
  if (at) {
    await requireCapability(opened, 'history')
    return buildSubmodelTree(await opened.target.submodelAt(submodelId, new Date(at).toISOString()))
  }
  return buildSubmodelTree(await opened.target.submodel(submodelId))
})
