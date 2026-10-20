import type { Page, SubmodelSummary } from '#shared/contract'
import { StudioProblem } from '~~/server/lib/problem'
import { defineStudioHandler, queryValidated } from '~~/server/utils/handler'
import { openTarget } from '~~/server/utils/target'
import { listQuerySchema } from '#shared/contract'

/** Submodels on their own, from the submodel registry or repository (`submodelListSource`), cursor-paged. */
export default defineStudioHandler(async (event): Promise<Page<SubmodelSummary>> => {
  const { limit, cursor } = queryValidated(event, listQuerySchema)
  const { target } = await openTarget(event)
  if (!target.capabilities.submodelListSource) {
    throw new StudioProblem('unsupported_operation', 'This target lists submodels only through their shells.')
  }
  return target.listSubmodels(limit, cursor)
})
