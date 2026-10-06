import type { Infrastructure } from '#shared/contract'
import { readBody, setResponseStatus } from 'nuxt/server'
import { createInfrastructure, toInfrastructure } from '~~/server/lib/infrastructures'
import { requireAdmin, requireCsrf } from '~~/server/utils/auth'
import { defineStudioHandler, requestIdOf } from '~~/server/utils/handler'
import { useStudio } from '~~/server/utils/studio'

export default defineStudioHandler(async (event): Promise<Infrastructure> => {
  const actor = await requireAdmin(event)
  await requireCsrf(event)
  const studio = await useStudio()
  const record = await createInfrastructure(studio, actor, await readBody(event), requestIdOf(event))
  setResponseStatus(event, 201)
  event.res.headers.set('ETag', `"${record.revision}"`)
  return toInfrastructure(record)
})
