import type { Page, ShellSummary } from '#shared/contract'
import { defineStudioHandler, queryValidated } from '~~/server/utils/handler'
import { openTarget } from '~~/server/utils/target'
import { listQuerySchema } from '#shared/contract'

export default defineStudioHandler(async (event): Promise<Page<ShellSummary>> => {
  const { limit, cursor } = queryValidated(event, listQuerySchema)
  const { target } = await openTarget(event)
  return target.listShells(limit, cursor)
})
