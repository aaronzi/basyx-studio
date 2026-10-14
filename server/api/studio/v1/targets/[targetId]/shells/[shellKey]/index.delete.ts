import { setResponseStatus } from 'nuxt/server'
import { decodeKey } from '~~/server/lib/aas/keys'
import { StudioProblem } from '~~/server/lib/problem'
import { requireCsrf } from '~~/server/utils/auth'
import { defineStudioHandler, routeParam } from '~~/server/utils/handler'
import { openTarget, requireCapability } from '~~/server/utils/target'

/** Deletes a shell. Its submodels stay in the submodel repository. */
export default defineStudioHandler(async (event): Promise<null> => {
  await requireCsrf(event)
  const shellId = decodeKey(routeParam(event, 'shellKey'), 'shell key')
  const opened = await openTarget(event)
  await requireCapability(opened, 'deleteShells')
  try {
    await opened.target.deleteShell(shellId)
    await opened.auditWrite('success', { operation: 'deleteShell', shellId })
  } catch (error) {
    await opened.auditWrite('failure', { operation: 'deleteShell', shellId, code: error instanceof StudioProblem ? error.code : 'internal_error' })
    throw error
  }
  setResponseStatus(event, 204)
  return null
})
