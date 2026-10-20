import type { DeleteResult } from '#shared/contract'
import { deleteSubmodelWithReferences } from '~~/server/lib/aas/creation'
import { decodeKey } from '~~/server/lib/aas/keys'
import { requireCsrf } from '~~/server/utils/auth'
import { auditedStructureWrite } from '~~/server/utils/elements'
import { defineStudioHandler, queryValidated, routeParam } from '~~/server/utils/handler'
import { openTarget, requireCapability } from '~~/server/utils/target'
import { submodelDeleteQuerySchema } from '#shared/contract'

/**
 * Deletes a submodel (the submodel view). With `removeReferences=true` the
 * shells that reference it lose their reference first; descriptors follow
 * where Studio keeps the registries in step.
 */
export default defineStudioHandler(async (event): Promise<DeleteResult> => {
  await requireCsrf(event)
  const submodelId = decodeKey(routeParam(event, 'submodelKey'), 'submodel key')
  const { removeReferences } = queryValidated(event, submodelDeleteQuerySchema)
  const opened = await openTarget(event)
  await requireCapability(opened, 'createResources')
  const sync = await auditedStructureWrite(
    opened,
    { operation: 'deleteSubmodel', submodelId, removeReferences },
    async () => deleteSubmodelWithReferences({ target: opened.target, scheme: opened.idScheme, plan: await opened.syncPlan() }, submodelId, removeReferences),
  )
  return { sync }
})
