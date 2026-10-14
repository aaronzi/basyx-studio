import type { ElementHit, SubmodelTree, TreeNode } from '#shared/contract'
import type { LocatorStep } from './keys'
import type { JsonObject } from './outline'
import { encodeKey, formatLocator } from './keys'
import { childrenOf, firstKeyValue, submodelChildren, toElementNode } from './outline'

/** Largest submodel Studio sends as one tree; larger ones are loaded level by level. */
export const maxTreeNodes = 5000

type Child = ReturnType<typeof submodelChildren>[number]

function valueTypeOf (child: Child): string | null {
  const value = child.value as JsonObject | null
  return typeof value?.valueType === 'string' ? value.valueType : null
}

function countNodes (children: Child[], limit: number): number {
  let count = 0
  const stack = [...children]
  while (stack.length > 0 && count <= limit) {
    const child = stack.pop()!
    count++
    if (child.value && typeof child.value === 'object') {
      stack.push(...childrenOf(child.value as JsonObject | JsonObject[], child.steps))
    }
  }
  return count
}

function toNode (child: Child, recurse: boolean): TreeNode {
  const node: TreeNode = { ...toElementNode(child), valueType: valueTypeOf(child) }
  if (recurse && node.hasChildren) {
    node.children = childrenOf(child.value as JsonObject | JsonObject[], child.steps).map(item => toNode(item, true))
  }
  return node
}

/**
 * The whole element tree of a submodel with value previews, so the UI can
 * filter, expand everything and refresh values without a request per level.
 */
export function buildSubmodelTree (submodel: JsonObject, limit = maxTreeNodes): SubmodelTree {
  const top = submodelChildren(submodel)
  const truncated = countNodes(top, limit) > limit
  return {
    key: encodeKey(String(submodel.id)),
    submodelId: String(submodel.id),
    idShort: typeof submodel.idShort === 'string' ? submodel.idShort : null,
    semanticId: firstKeyValue(submodel.semanticId),
    truncated,
    root: top.map(child => toNode(child, !truncated)),
  }
}

/** Elements whose idShort contains `text` (case-insensitive), depth first. */
export function findElements (submodel: JsonObject, text: string, limit: number): Array<{ steps: LocatorStep[], label: string, modelType: string }> {
  const needle = text.toLowerCase()
  const hits: Array<{ steps: LocatorStep[], label: string, modelType: string }> = []
  const visit = (children: Child[]) => {
    for (const child of children) {
      if (hits.length >= limit) {
        return
      }
      const value = child.value as JsonObject | JsonObject[]
      if (!child.variableGroup && !Array.isArray(value) && child.label.toLowerCase().includes(needle)) {
        hits.push({ steps: child.steps, label: child.label, modelType: String(value.modelType ?? 'Unknown') })
      }
      if (value && typeof value === 'object') {
        visit(childrenOf(value, child.steps))
      }
    }
  }
  visit(submodelChildren(submodel))
  return hits
}

/** Search hits of one submodel, attributed to the shell that references it (if known). */
export function elementHits (
  submodel: JsonObject,
  text: string,
  limit: number,
  shell: { key: string, label: string } | null,
): ElementHit[] {
  const submodelLabel = typeof submodel.idShort === 'string' ? submodel.idShort : String(submodel.id)
  return findElements(submodel, text, limit).map(hit => {
    const path = formatLocator(hit.steps)
    return {
      shellKey: shell?.key ?? null,
      shellLabel: shell?.label ?? null,
      submodelKey: encodeKey(String(submodel.id)),
      submodelLabel,
      elementKey: encodeKey(path),
      label: hit.label,
      modelType: hit.modelType,
      path,
    }
  })
}
