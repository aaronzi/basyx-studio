import type { ElementNode } from '#shared/contract'
import { z } from 'zod'
import { decodeKey, parseLocator, splitAddressable } from '~~/server/lib/aas/keys'
import { childrenOf, navigate, submodelChildren, toElementNode } from '~~/server/lib/aas/outline'
import { StudioProblem } from '~~/server/lib/problem'

const querySchema = z.object({ parentElementKey: z.string().max(4000).optional() })

export default defineStudioHandler(async (event): Promise<{ items: ElementNode[] }> => {
  const submodelId = decodeKey(routeParam(event, 'submodelKey'), 'submodel key')
  const { parentElementKey } = queryValidated(event, querySchema)
  const { target } = await openTarget(event)

  if (!parentElementKey) {
    const submodel = await target.submodel(submodelId)
    return { items: submodelChildren(submodel).map(child => toElementNode(child)) }
  }

  const steps = parseLocator(decodeKey(parentElementKey, 'element key'))
  const { idShortPath, rest } = splitAddressable(steps)
  const parent = navigate(await target.element(submodelId, idShortPath), rest)
  if (!parent) {
    throw new StudioProblem('target_resource_not_found')
  }
  return { items: childrenOf(parent, steps).map(child => toElementNode(child)) }
})
