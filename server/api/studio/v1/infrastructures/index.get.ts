import type { Infrastructure } from '#shared/contract'
import { listInfrastructures, toInfrastructure } from '~~/server/lib/infrastructures'

export default defineStudioHandler(async (event): Promise<{ items: Infrastructure[] }> => {
  await requireAdmin(event)
  const studio = await useStudio()
  return { items: (await listInfrastructures(studio)).map(record => toInfrastructure(record)) }
})
