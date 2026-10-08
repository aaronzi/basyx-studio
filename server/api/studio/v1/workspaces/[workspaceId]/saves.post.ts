import type { Target } from '#shared/contract'
import { StudioProblem } from '~~/server/lib/problem'
import { isWorkspaceId, toWorkspaceTarget } from '~~/server/lib/workspaces/manager'
import { requireActor, requireCsrf } from '~~/server/utils/auth'
import { requireWorkspaces } from '~~/server/utils/desktop'
import { defineStudioHandler, routeParam } from '~~/server/utils/handler'
import { useStudio } from '~~/server/utils/studio'

/** Saves the workspace atomically to its file. */
export default defineStudioHandler(async (event): Promise<Target> => {
  await requireActor(event)
  await requireCsrf(event)
  const workspaceId = routeParam(event, 'workspaceId')
  if (!isWorkspaceId(workspaceId)) {
    throw new StudioProblem('not_found')
  }
  return toWorkspaceTarget(await requireWorkspaces(await useStudio()).save(workspaceId))
})
