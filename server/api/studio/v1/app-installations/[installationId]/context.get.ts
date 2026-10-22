import type { AppTargetContext } from '#shared/contract'
import { userTargetContext } from '~~/server/lib/apps/settings'
import { getInstallation } from '~~/server/lib/apps/store'
import { getInfrastructure } from '~~/server/lib/infrastructures'
import { isWorkspaceId } from '~~/server/lib/workspaces/manager'
import { requireActor } from '~~/server/utils/auth'
import { defineStudioHandler, queryValidated, routeParam } from '~~/server/utils/handler'
import { useStudio } from '~~/server/utils/studio'
import { appContextQuerySchema } from '#shared/contract'

/**
 * What Studio's page adds to an app frame's context on a target (ADR 0048):
 * the resolved settings and whether each declared connection is bound. Only
 * users who may open the infrastructure get its values, as connection calls
 * check.
 */
export default defineStudioHandler(async (event): Promise<AppTargetContext> => {
  const actor = await requireActor(event)
  const { targetId } = queryValidated(event, appContextQuerySchema)
  const studio = await useStudio()
  const installation = await getInstallation(studio, routeParam(event, 'installationId'))
  const record = targetId && !isWorkspaceId(targetId) ? await getInfrastructure(studio, targetId) : null
  return userTargetContext(studio.broker, actor.sessionId, installation, record)
})
