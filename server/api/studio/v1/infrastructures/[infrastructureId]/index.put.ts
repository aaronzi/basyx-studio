import type { Infrastructure } from '#shared/contract'
import { toInfrastructure, updateInfrastructure } from '~~/server/lib/infrastructures'
import { StudioProblem } from '~~/server/lib/problem'

export default defineStudioHandler(async (event): Promise<Infrastructure> => {
  const actor = await requireAdmin(event)
  await requireCsrf(event)
  const match = /^"(\d+)"$/.exec(getHeader(event, 'if-match') ?? '')
  if (!match) {
    throw new StudioProblem('invalid_request', 'An If-Match header with the current revision is required.')
  }
  const studio = await useStudio()
  const record = await updateInfrastructure(studio, actor, routeParam(event, 'infrastructureId'), Number(match[1]), await readBody(event), requestIdOf(event))
  setResponseHeader(event, 'ETag', `"${record.revision}"`)
  return toInfrastructure(record)
})
