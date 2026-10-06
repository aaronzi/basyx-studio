import type { ProbeResult } from '#shared/contract'
import { getInfrastructure, probeEndpoints } from '~~/server/lib/infrastructures'
import { requireAdmin, requireCsrf } from '~~/server/utils/auth'
import { defineStudioHandler, routeParam } from '~~/server/utils/handler'
import { useStudio } from '~~/server/utils/studio'

export default defineStudioHandler(async (event): Promise<ProbeResult> => {
  await requireAdmin(event)
  await requireCsrf(event)
  const studio = await useStudio()
  return probeEndpoints(studio, await getInfrastructure(studio, routeParam(event, 'infrastructureId')))
})
