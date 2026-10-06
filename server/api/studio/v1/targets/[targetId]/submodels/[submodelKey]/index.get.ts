import type { SubmodelDetail } from '#shared/contract'
import { decodeKey } from '~~/server/lib/aas/keys'
import { defineStudioHandler, routeParam } from '~~/server/utils/handler'
import { openTarget } from '~~/server/utils/target'

export default defineStudioHandler(async (event): Promise<SubmodelDetail> => {
  const key = routeParam(event, 'submodelKey')
  const submodelId = decodeKey(key, 'submodel key')
  const { target } = await openTarget(event)
  return { key, submodel: await target.submodelMetadata(submodelId) }
})
