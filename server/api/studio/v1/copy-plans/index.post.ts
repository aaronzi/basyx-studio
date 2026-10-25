import type { CopyPlan } from '#shared/contract'
import { setResponseStatus } from 'nuxt/server'
import { decodeKey } from '~~/server/lib/aas/keys'
import { EnvironmentReader } from '~~/server/lib/copies/source'
import { parsePastedText } from '~~/server/lib/copies/text'
import { requireCsrf } from '~~/server/utils/auth'
import { createCopyPlan, environmentRoots } from '~~/server/utils/copies'
import { defineStudioHandler, readValidated } from '~~/server/utils/handler'
import { copyPlanRequestSchema } from '#shared/contract'

/**
 * Plans a copy of shells, submodels or concept descriptions from a target,
 * or of AAS JSON or XML text, into a target (package editing plan, K4,
 * K9): what would be written, collisions, files and findings. Writes nothing.
 */
export default defineStudioHandler(async (event): Promise<CopyPlan> => {
  await requireCsrf(event)
  const input = await readValidated(event, copyPlanRequestSchema)
  const common = {
    destinationTargetId: input.destinationTargetId,
    destinationShellKey: input.destinationShellKey ?? null,
    dependencies: input.dependencies,
  }
  let plan: CopyPlan
  if (input.source.kind === 'target') {
    plan = await createCopyPlan(event, {
      ...common,
      source: { kind: 'target', targetId: input.source.targetId },
      sourceLabel: '',
      roots: input.source.resources.map(resource => ({ type: resource.type, id: decodeKey(resource.key) })),
    })
  } else {
    const pasted = parsePastedText(input.source.format, input.source.content)
    const reader = new EnvironmentReader(pasted.environment)
    plan = await createCopyPlan(event, { ...common, source: { kind: 'environment', reader }, sourceLabel: pasted.label, roots: environmentRoots(reader) })
  }
  setResponseStatus(event, 201)
  return plan
})
