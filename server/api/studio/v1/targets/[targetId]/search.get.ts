import type { SearchResult } from '#shared/contract'
import { defineStudioHandler, queryValidated } from '~~/server/utils/handler'
import { openTarget } from '~~/server/utils/target'
import { searchQuerySchema } from '#shared/contract'

/** Shells (and, where supported, submodel elements) matching a text. */
export default defineStudioHandler(async (event): Promise<SearchResult> => {
  const { q, limit } = queryValidated(event, searchQuerySchema)
  const { target } = await openTarget(event)
  if (target.capabilities.search === 'none') {
    return { shells: [], elements: [] }
  }
  return target.search(q, limit)
})
