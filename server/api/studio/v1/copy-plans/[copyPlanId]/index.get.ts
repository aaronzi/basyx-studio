import type { CopyPlan } from '#shared/contract'
import { requireActor } from '~~/server/utils/auth'
import { defineStudioHandler, routeParam } from '~~/server/utils/handler'
import { useStudio } from '~~/server/utils/studio'

/** A copy plan of the signed-in user, until it expires. */
export default defineStudioHandler(async (event): Promise<CopyPlan> => {
  const studio = await useStudio()
  const actor = await requireActor(event)
  return studio.copies.get(routeParam(event, 'copyPlanId'), actor.subject).plan
})
