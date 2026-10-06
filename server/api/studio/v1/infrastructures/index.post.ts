import type { Infrastructure } from '#shared/contract'
import { createInfrastructure, toInfrastructure } from '~~/server/lib/infrastructures'

export default defineStudioHandler(async (event): Promise<Infrastructure> => {
  const actor = await requireAdmin(event)
  await requireCsrf(event)
  const studio = await useStudio()
  const record = await createInfrastructure(studio, actor, await readBody(event), requestIdOf(event))
  setResponseStatus(event, 201)
  setResponseHeader(event, 'ETag', `"${record.revision}"`)
  return toInfrastructure(record)
})
