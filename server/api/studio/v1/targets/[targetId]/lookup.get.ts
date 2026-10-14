import type { ShellSummary } from '#shared/contract'
import { defineStudioHandler, queryValidated } from '~~/server/utils/handler'
import { openTarget, requireCapability } from '~~/server/utils/target'
import { lookupQuerySchema } from '#shared/contract'

/** Shells of an asset, found by its global asset ID. */
export default defineStudioHandler(async (event): Promise<{ items: ShellSummary[] }> => {
  const { assetId } = queryValidated(event, lookupQuerySchema)
  const opened = await openTarget(event)
  await requireCapability(opened, 'discovery')
  return { items: await opened.target.lookupShells(assetId) }
})
