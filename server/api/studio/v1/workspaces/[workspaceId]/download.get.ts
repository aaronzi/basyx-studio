import { allRoots, exportEnvironment } from '~~/server/lib/copies/serialize'
import { StudioProblem } from '~~/server/lib/problem'
import { isWorkspaceId } from '~~/server/lib/workspaces/manager'
import { requireActor } from '~~/server/utils/auth'
import { requireWorkspaces } from '~~/server/utils/desktop'
import { sendBinary } from '~~/server/utils/files'
import { defineStudioHandler, queryValidated, routeParam } from '~~/server/utils/handler'
import { useStudio } from '~~/server/utils/studio'
import { exportQuerySchema } from '#shared/contract'

/**
 * The whole package, as it is now with unsaved changes, as an AASX package
 * or an AAS environment in JSON or XML (package editing plan, E3); the
 * package's own file stays as it is.
 */
export default defineStudioHandler(async (event): Promise<Uint8Array> => {
  await requireActor(event)
  const workspaceId = routeParam(event, 'workspaceId')
  if (!isWorkspaceId(workspaceId)) {
    throw new StudioProblem('not_found')
  }
  const { format } = queryValidated(event, exportQuerySchema)
  const studio = await useStudio()
  const workspaces = requireWorkspaces(studio)
  // The worker that holds the packages writes the new one too.
  const inspector = studio.inspector
  if (!inspector) {
    throw new StudioProblem('unsupported_operation', 'Packages need the Workspace Worker, which is not available.')
  }
  const target = workspaces.target(workspaceId)
  const file = await exportEnvironment(target, await allRoots(target), format, (environment, files) => inspector.request({ op: 'pack', environment, files }))
  const name = (await workspaces.list()).find(info => info.workspaceId === workspaceId)?.fileName.replace(/\.aasx$/i, '') || 'package'
  return sendBinary(event, { ...file, fileName: `${name}.${format}` })
})
