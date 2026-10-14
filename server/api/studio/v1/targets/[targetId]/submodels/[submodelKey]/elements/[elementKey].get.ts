import type { ElementDetail } from '#shared/contract'
import { parseLocator } from '~~/server/lib/aas/keys'
import { navigate } from '~~/server/lib/aas/outline'
import { StudioProblem } from '~~/server/lib/problem'
import { elementRoute, toElementDetail } from '~~/server/utils/elements'
import { defineStudioHandler, queryValidated } from '~~/server/utils/handler'
import { openTarget, requireCapability } from '~~/server/utils/target'
import { submodelTreeQuerySchema } from '#shared/contract'

/**
 * An element with its revision, or (with `at`) as it was at a point in time.
 * A historic element has no revision, so it cannot be written.
 */
export default defineStudioHandler(async (event): Promise<ElementDetail> => {
  const route = elementRoute(event)
  const { at } = queryValidated(event, submodelTreeQuerySchema)
  const opened = await openTarget(event)
  if (!at) {
    return toElementDetail(event, route, await opened.target.element(route.submodelId, route.idShortPath))
  }
  await requireCapability(opened, 'history')
  const submodel = await opened.target.submodelAt(route.submodelId, new Date(at).toISOString())
  // The submodel's elements, addressed like the children of a collection.
  const value = navigate({ modelType: 'SubmodelElementCollection', value: submodel.submodelElements }, parseLocator(route.locator))
  if (value === undefined) {
    throw new StudioProblem('target_resource_not_found')
  }
  return { key: route.key, path: route.locator, value, revision: null, concurrency: null }
})
