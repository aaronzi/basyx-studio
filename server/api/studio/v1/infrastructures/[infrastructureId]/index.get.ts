import type { Infrastructure } from '#shared/contract'
import { getInfrastructure, toInfrastructure } from '~~/server/lib/infrastructures'
import { requireAdmin } from '~~/server/utils/auth'
import { defineStudioHandler, routeParam } from '~~/server/utils/handler'
import { useStudio } from '~~/server/utils/studio'

export default defineStudioHandler(async (event): Promise<Infrastructure> => {
  await requireAdmin(event)
  const studio = await useStudio()
  const record = await getInfrastructure(studio, routeParam(event, 'infrastructureId'))
  event.res.headers.set('ETag', `"${record.revision}"`)
  return toInfrastructure(record)
})
