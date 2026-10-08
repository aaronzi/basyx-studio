import type { Infrastructure } from '#shared/contract'
import { getRequestHeader, readBody } from 'nuxt/server'
import { toInfrastructure, updateInfrastructure } from '~~/server/lib/infrastructures'
import { StudioProblem } from '~~/server/lib/problem'
import { requireAdmin, requireCsrf } from '~~/server/utils/auth'
import { defineStudioHandler, requestIdOf, routeParam } from '~~/server/utils/handler'
import { useStudio } from '~~/server/utils/studio'

export default defineStudioHandler(async (event): Promise<Infrastructure> => {
  const actor = await requireAdmin(event)
  await requireCsrf(event)
  const match = /^"(\d+)"$/.exec(getRequestHeader(event, 'if-match') ?? '')
  if (!match) {
    throw new StudioProblem('invalid_request', 'An If-Match header with the current revision is required.')
  }
  const studio = await useStudio()
  const record = await updateInfrastructure(studio, actor, routeParam(event, 'infrastructureId'), Number(match[1]), await readBody(event), requestIdOf(event))
  event.res.headers.set('ETag', `"${record.revision}"`)
  return toInfrastructure(record)
})
