import { setResponseStatus } from 'nuxt/server'
import { deleteInfrastructure } from '~~/server/lib/infrastructures'
import { requireAdmin, requireCsrf } from '~~/server/utils/auth'
import { defineStudioHandler, requestIdOf, routeParam } from '~~/server/utils/handler'
import { useStudio } from '~~/server/utils/studio'

export default defineStudioHandler(async (event): Promise<null> => {
  const actor = await requireAdmin(event)
  await requireCsrf(event)
  const studio = await useStudio()
  await deleteInfrastructure(studio, actor, routeParam(event, 'infrastructureId'), requestIdOf(event))
  setResponseStatus(event, 204)
  return null
})
