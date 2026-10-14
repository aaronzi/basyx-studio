import type { Target } from '#shared/contract'
import { getInfrastructure } from '~~/server/lib/infrastructures'
import { isWorkspaceId, toWorkspaceTarget } from '~~/server/lib/workspaces/manager'
import { requireActor } from '~~/server/utils/auth'
import { requireWorkspaces } from '~~/server/utils/desktop'
import { defineStudioHandler, requestIdOf, routeParam } from '~~/server/utils/handler'
import { useStudio } from '~~/server/utils/studio'
import { detectedFeatures, toTarget } from '~~/server/utils/target'

/** One target with its capabilities; optional features are detected once authorized. */
export default defineStudioHandler(async (event): Promise<Target> => {
  const actor = await requireActor(event)
  const studio = await useStudio()
  const targetId = routeParam(event, 'targetId')
  if (isWorkspaceId(targetId)) {
    return toWorkspaceTarget(await requireWorkspaces(studio).info(targetId))
  }
  const record = await getInfrastructure(studio, targetId)
  const authenticationState = await studio.broker.authenticationState(record, actor.sessionId)
  const features = authenticationState === 'required'
    ? null
    : await detectedFeatures({ actor, targetId, requestId: requestIdOf(event) })
  return toTarget(record, authenticationState, features)
})
