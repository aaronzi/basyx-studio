import { setResponseStatus } from 'nuxt/server'
import { recordAudit } from '~~/server/lib/audit'
import { getInfrastructure } from '~~/server/lib/infrastructures'
import { requireActor, requireCsrf } from '~~/server/utils/auth'
import { defineStudioHandler, requestIdOf, routeParam } from '~~/server/utils/handler'
import { useStudio } from '~~/server/utils/studio'

export default defineStudioHandler(async (event): Promise<null> => {
  const actor = await requireActor(event)
  await requireCsrf(event)
  const studio = await useStudio()
  const record = await getInfrastructure(studio, routeParam(event, 'targetId'))
  await studio.broker.revoke(record.id, actor.sessionId)
  await recordAudit(studio, { action: 'target.revoke', outcome: 'success', requestId: requestIdOf(event), actorSubject: actor.subject, targetId: record.id })
  setResponseStatus(event, 204)
  return null
})
