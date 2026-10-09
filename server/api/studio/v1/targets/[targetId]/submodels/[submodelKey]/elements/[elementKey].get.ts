import type { ElementDetail } from '#shared/contract'
import { elementRoute, toElementDetail } from '~~/server/utils/elements'
import { defineStudioHandler } from '~~/server/utils/handler'
import { openTarget } from '~~/server/utils/target'

export default defineStudioHandler(async (event): Promise<ElementDetail> => {
  const route = elementRoute(event)
  const { target } = await openTarget(event)
  return toElementDetail(event, route, await target.element(route.submodelId, route.idShortPath))
})
