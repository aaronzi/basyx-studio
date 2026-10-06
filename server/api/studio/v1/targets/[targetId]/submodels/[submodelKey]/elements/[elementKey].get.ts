import type { ElementDetail } from '#shared/contract'
import { decodeKey, parseLocator, splitAddressable } from '~~/server/lib/aas/keys'
import { navigate } from '~~/server/lib/aas/outline'
import { StudioProblem } from '~~/server/lib/problem'

export default defineStudioHandler(async (event): Promise<ElementDetail> => {
  const submodelId = decodeKey(routeParam(event, 'submodelKey'), 'submodel key')
  const key = routeParam(event, 'elementKey')
  const locator = decodeKey(key, 'element key')
  const { idShortPath, rest } = splitAddressable(parseLocator(locator))
  const { target } = await openTarget(event)
  const value = navigate(await target.element(submodelId, idShortPath), rest)
  if (value === undefined) {
    throw new StudioProblem('target_resource_not_found')
  }
  return { key, path: locator, value }
})
