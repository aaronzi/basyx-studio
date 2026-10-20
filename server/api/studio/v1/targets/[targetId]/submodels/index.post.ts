import type { SyncStep } from '#shared/contract'
import { setResponseStatus } from 'nuxt/server'
import { createStandaloneSubmodel } from '~~/server/lib/aas/creation'
import { encodeKey } from '~~/server/lib/aas/keys'
import { requireCsrf } from '~~/server/utils/auth'
import { auditedStructureWrite } from '~~/server/utils/elements'
import { defineStudioHandler, readValidated } from '~~/server/utils/handler'
import { openTarget, requireCapability } from '~~/server/utils/target'
import { submodelCreateSchema } from '#shared/contract'

/** Creates a submodel on its own (the submodel view): empty, from a template or from JSON. */
export default defineStudioHandler(async (event): Promise<{ submodelKey: string, steps: SyncStep[] }> => {
  await requireCsrf(event)
  const { submodel } = await readValidated(event, submodelCreateSchema)
  const opened = await openTarget(event)
  await requireCapability(opened, 'createResources')
  const result = await auditedStructureWrite(
    opened,
    { operation: 'createSubmodel', source: submodel.source },
    async () => createStandaloneSubmodel({ target: opened.target, scheme: opened.idScheme, plan: await opened.syncPlan() }, submodel),
  )
  setResponseStatus(event, 201)
  return { submodelKey: encodeKey(result.submodelId), steps: result.steps }
})
