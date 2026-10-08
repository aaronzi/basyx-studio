import type { Target } from '#shared/contract'
import { listInfrastructures } from '~~/server/lib/infrastructures'
import { requireActor } from '~~/server/utils/auth'
import { defineStudioHandler } from '~~/server/utils/handler'
import { useStudio } from '~~/server/utils/studio'
import { toTarget } from '~~/server/utils/target'

export default defineStudioHandler(async (event): Promise<{ items: Target[] }> => {
  const actor = await requireActor(event)
  const studio = await useStudio()
  const records = await listInfrastructures(studio)
  return {
    items: await Promise.all(records.map(async record => toTarget(record, await studio.broker.authenticationState(record, actor.sessionId)))),
  }
})
