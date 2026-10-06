import type { Infrastructure } from '#shared/contract'
import { getInfrastructure, toInfrastructure } from '~~/server/lib/infrastructures'

export default defineStudioHandler(async (event): Promise<Infrastructure> => {
  await requireAdmin(event)
  const studio = await useStudio()
  const record = await getInfrastructure(studio, routeParam(event, 'infrastructureId'))
  setResponseHeader(event, 'ETag', `"${record.revision}"`)
  return toInfrastructure(record)
})
