import type { ElementDetail } from '#shared/contract'
import { getRequestHeader } from 'nuxt/server'
import { StudioProblem } from '~~/server/lib/problem'
import { requireCsrf } from '~~/server/utils/auth'
import { elementRoute, toElementDetail } from '~~/server/utils/elements'
import { defineStudioHandler, readValidated } from '~~/server/utils/handler'
import { openTarget } from '~~/server/utils/target'
import { elementValueInputSchema } from '#shared/contract'

/** Sets the value of a Property or MultiLanguageProperty; requires `If-Match`. */
export default defineStudioHandler(async (event): Promise<ElementDetail> => {
  await requireCsrf(event)
  const route = elementRoute(event)
  if (route.rest.length > 0) {
    throw new StudioProblem('unsupported_operation', 'Operation variables cannot be edited separately.')
  }
  const revision = getRequestHeader(event, 'if-match')
  const { value } = await readValidated(event, elementValueInputSchema)
  const { target, auditWrite } = await openTarget(event)
  const details = { submodelId: route.submodelId, path: route.idShortPath }
  try {
    const snapshot = await target.setElementValue(route.submodelId, route.idShortPath, value, revision ?? '')
    await auditWrite('success', details)
    return toElementDetail(event, route, snapshot)
  } catch (error) {
    await auditWrite('failure', { ...details, code: error instanceof StudioProblem ? error.code : 'internal_error' })
    throw error
  }
})
