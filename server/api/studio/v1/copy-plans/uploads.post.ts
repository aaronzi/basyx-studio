import type { CopyPlan } from '#shared/contract'
import { setResponseStatus } from 'nuxt/server'
import { EnvironmentReader } from '~~/server/lib/copies/source'
import { StudioProblem } from '~~/server/lib/problem'
import { uploadFormatOf } from '~~/server/lib/workspaces/package'
import { requireCsrf } from '~~/server/utils/auth'
import { createCopyPlan, environmentRoots } from '~~/server/utils/copies'
import { readFileBody } from '~~/server/utils/files'
import { defineStudioHandler, queryValidated } from '~~/server/utils/handler'
import { useStudio } from '~~/server/utils/studio'
import { copyUploadQuerySchema } from '#shared/contract'

/**
 * Plans the import of an AASX, JSON or XML file into a target as a copy
 * (package editing plan, E1), e.g. into an AASX package, which has no
 * BaSyx upload. The Workspace Worker reads the file (D16).
 */
export default defineStudioHandler(async (event): Promise<CopyPlan> => {
  await requireCsrf(event)
  const studio = await useStudio()
  const query = queryValidated(event, copyUploadQuerySchema)
  if (!studio.config.deployment.uploads) {
    throw new StudioProblem('forbidden', 'This Studio deployment does not accept file uploads.')
  }
  const file = await readFileBody(event, studio.config.uploadMaxBytes)
  const format = uploadFormatOf(query.fileName, file.contentType)
  if (!format) {
    throw new StudioProblem('invalid_request', 'Import an .aasx, .json or .xml file.')
  }
  if (!studio.inspector) {
    throw new StudioProblem('unsupported_operation', 'Imports need the Workspace Worker, which is not available.')
  }
  const extracted = await studio.inspector.request({ op: 'extract', bytes: file.bytes, format })
  const reader = new EnvironmentReader(extracted.environment, extracted.files)
  const plan = await createCopyPlan(event, {
    source: { kind: 'environment', reader },
    sourceLabel: query.fileName,
    roots: environmentRoots(reader),
    destinationTargetId: query.destinationTargetId,
    destinationShellKey: query.destinationShellKey ?? null,
    dependencies: { submodels: 'referenced', conceptDescriptions: 'referenced', supplementaryFiles: 'referenced' },
  })
  setResponseStatus(event, 201)
  return plan
})
