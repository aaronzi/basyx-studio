import type { SubmodelDetail } from '#shared/contract'
import { decodeKey } from '~~/server/lib/aas/keys'

export default defineStudioHandler(async (event): Promise<SubmodelDetail> => {
  const key = routeParam(event, 'submodelKey')
  const submodelId = decodeKey(key, 'submodel key')
  const { target } = await openTarget(event)
  return { key, submodel: await target.submodelMetadata(submodelId) }
})
