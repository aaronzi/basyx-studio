import { setResponseStatus } from 'nuxt/server'
import { z } from 'zod'
import { StudioProblem } from '~~/server/lib/problem'
import { isWorkspaceId } from '~~/server/lib/workspaces/manager'
import { requireActor, requireCsrf } from '~~/server/utils/auth'
import { requireWorkspaces } from '~~/server/utils/desktop'
import { defineStudioHandler, queryValidated, routeParam } from '~~/server/utils/handler'
import { useStudio } from '~~/server/utils/studio'

const querySchema = z.object({ force: z.enum(['true', 'false']).default('false') })

/** Closes the workspace; refuses with unsaved changes unless `force=true`. */
export default defineStudioHandler(async (event): Promise<null> => {
  await requireActor(event)
  await requireCsrf(event)
  const workspaceId = routeParam(event, 'workspaceId')
  if (!isWorkspaceId(workspaceId)) {
    throw new StudioProblem('not_found')
  }
  const { force } = queryValidated(event, querySchema)
  await requireWorkspaces(await useStudio()).close(workspaceId, force === 'true')
  setResponseStatus(event, 204)
  return null
})
