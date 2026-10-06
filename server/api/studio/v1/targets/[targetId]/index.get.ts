import type { Target } from '#shared/contract'
import { getInfrastructure } from '~~/server/lib/infrastructures'

export default defineStudioHandler(async (event): Promise<Target> => {
  const actor = await requireActor(event)
  const studio = await useStudio()
  const record = await getInfrastructure(studio, routeParam(event, 'targetId'))
  return toTarget(record, await studio.broker.authenticationState(record, actor.sessionId))
})
