import type { Infrastructure } from '#shared/contract'
import { listInfrastructures, toInfrastructure } from '~~/server/lib/infrastructures'
import { requireAdmin } from '~~/server/utils/auth'
import { defineStudioHandler } from '~~/server/utils/handler'
import { useStudio } from '~~/server/utils/studio'

export default defineStudioHandler(async (event): Promise<{ items: Infrastructure[] }> => {
  await requireAdmin(event)
  const studio = await useStudio()
  return { items: (await listInfrastructures(studio)).map(record => toInfrastructure(record)) }
})
