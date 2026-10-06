import type { SubmodelRef } from '#shared/contract'
import { decodeKey, encodeKey } from '~~/server/lib/aas/keys'
import { firstKeyValue } from '~~/server/lib/aas/outline'
import { StudioProblem } from '~~/server/lib/problem'

const concurrency = 6

export default defineStudioHandler(async (event): Promise<{ items: SubmodelRef[] }> => {
  const shellId = decodeKey(routeParam(event, 'shellKey'), 'shell key')
  const { target } = await openTarget(event)
  const ids = await target.submodelIds(shellId)

  // Resolve names per reference; a forbidden or missing submodel is reported
  // on its entry instead of failing the whole list (partial access).
  const items: SubmodelRef[] = Array.from({ length: ids.length })
  let next = 0
  async function worker () {
    while (next < ids.length) {
      const index = next++
      const submodelId = ids[index]!
      const base = { key: encodeKey(submodelId), submodelId, idShort: null, semanticId: null }
      try {
        const metadata = await target.submodelMetadata(submodelId)
        items[index] = {
          ...base,
          idShort: typeof metadata.idShort === 'string' ? metadata.idShort : null,
          semanticId: firstKeyValue(metadata.semanticId),
          status: 'available',
        }
      } catch (error) {
        if (!(error instanceof StudioProblem)) {
          throw error
        }
        if (error.code === 'target_auth_required' || error.code === 'target_credentials_rejected') {
          throw error
        }
        const status = error.code === 'target_forbidden'
          ? 'forbidden'
          : (error.code === 'target_resource_not_found' ? 'not_found' : 'error')
        items[index] = { ...base, status }
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, ids.length) }, () => worker()))
  return { items }
})
