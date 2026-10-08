import type { AuthorizationStart } from '#shared/contract'
import { getInfrastructure } from '~~/server/lib/infrastructures'
import { requireActor, requireCsrf } from '~~/server/utils/auth'
import { defineStudioHandler, readValidated, routeParam } from '~~/server/utils/handler'
import { useStudio } from '~~/server/utils/studio'
import { loginRequestSchema } from '#shared/contract'

export default defineStudioHandler(async (event): Promise<AuthorizationStart> => {
  const actor = await requireActor(event)
  await requireCsrf(event)
  const studio = await useStudio()
  const { returnTo } = await readValidated(event, loginRequestSchema)
  const record = await getInfrastructure(studio, routeParam(event, 'targetId'))
  return studio.broker.startAuthorization(record, actor.sessionId, returnTo ?? `/targets/${record.id}`)
})
