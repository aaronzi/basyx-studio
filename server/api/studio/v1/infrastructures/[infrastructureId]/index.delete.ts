import { deleteInfrastructure } from '~~/server/lib/infrastructures'

export default defineStudioHandler(async (event): Promise<null> => {
  const actor = await requireAdmin(event)
  await requireCsrf(event)
  const studio = await useStudio()
  await deleteInfrastructure(studio, actor, routeParam(event, 'infrastructureId'), requestIdOf(event))
  setResponseStatus(event, 204)
  return null
})
