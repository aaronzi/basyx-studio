import type { ElementNode, OperationVariableGroup } from '#shared/contract'
import type { LocatorStep } from './keys'
import { encodeKey, formatLocator } from './keys'

export type JsonObject = Record<string, unknown>

const variableProperties: Record<OperationVariableGroup, string> = {
  input: 'inputVariables',
  output: 'outputVariables',
  inoutput: 'inoutputVariables',
}

function isObject (value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function objects (value: unknown): JsonObject[] {
  return Array.isArray(value) ? value.filter(isObject) : []
}

function variableValues (operation: JsonObject, group: OperationVariableGroup): JsonObject[] {
  return objects(operation[variableProperties[group]])
    .map(variable => variable.value)
    .filter(isObject)
}

interface Child {
  steps: LocatorStep[]
  label: string
  value: unknown
  variableGroup: OperationVariableGroup | null
}

/**
 * Direct children of a submodel element (or of a synthetic operation variable
 * group), each with its locator. `steps` is the locator of `element` itself.
 */
export function childrenOf (element: JsonObject | JsonObject[], steps: readonly LocatorStep[]): Child[] {
  const last = steps.at(-1)
  if (last?.kind === 'variables') {
    return objects(element).map(value => ({
      steps: [...steps, { kind: 'idShort', idShort: String(value.idShort) }],
      label: String(value.idShort ?? ''),
      value,
      variableGroup: null,
    }))
  }
  if (Array.isArray(element)) {
    return []
  }

  const named = (items: JsonObject[]): Child[] => items.map(item => ({
    steps: [...steps, { kind: 'idShort', idShort: String(item.idShort) }],
    label: String(item.idShort ?? ''),
    value: item,
    variableGroup: null,
  }))

  switch (element.modelType) {
    case 'SubmodelElementCollection': {
      return named(objects(element.value))
    }
    case 'Entity': {
      return named(objects(element.statements))
    }
    case 'AnnotatedRelationshipElement': {
      return named(objects(element.annotations))
    }
    case 'SubmodelElementList': {
      return objects(element.value).map((item, index) => ({
        steps: [...steps, { kind: 'index', index }],
        label: `[${index}]`,
        value: item,
        variableGroup: null,
      }))
    }
    case 'Operation': {
      return (Object.keys(variableProperties) as OperationVariableGroup[])
        .filter(group => variableValues(element, group).length > 0)
        .map(group => ({
          steps: [...steps, { kind: 'variables', group }],
          label: group,
          value: variableValues(element, group),
          variableGroup: group,
        }))
    }
    default: {
      return []
    }
  }
}

/** Top-level elements of a submodel. */
export function submodelChildren (submodel: JsonObject): Child[] {
  return objects(submodel.submodelElements).map(item => ({
    steps: [{ kind: 'idShort', idShort: String(item.idShort) }],
    label: String(item.idShort ?? ''),
    value: item,
    variableGroup: null,
  }))
}

/**
 * Resolves the remaining locator steps inside an element fetched from the AAS
 * API. Returns undefined if the path does not exist.
 */
export function navigate (element: JsonObject, rest: readonly LocatorStep[]): JsonObject | JsonObject[] | undefined {
  let current: JsonObject | JsonObject[] = element
  for (const [position, step] of rest.entries()) {
    const candidates = childrenOf(current, rest.slice(0, position))
    const next = candidates.find(child => {
      const childStep = child.steps.at(-1)!
      if (step.kind === 'idShort') {
        return childStep.kind === 'idShort' && childStep.idShort === step.idShort
      }
      if (step.kind === 'index') {
        return childStep.kind === 'index' && childStep.index === step.index
      }
      return childStep.kind === 'variables' && childStep.group === step.group
    })
    if (!next || !(isObject(next.value) || Array.isArray(next.value))) {
      return undefined
    }
    current = next.value as JsonObject | JsonObject[]
  }
  return current
}

export function firstKeyValue (reference: unknown): string | null {
  if (!isObject(reference)) {
    return null
  }
  const first = objects(reference.keys)[0]
  return typeof first?.value === 'string' ? first.value : null
}

function truncate (text: string, max = 80): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

function preview (value: JsonObject): string | null {
  switch (value.modelType) {
    case 'Property': {
      return typeof value.value === 'string' ? truncate(value.value) : null
    }
    case 'MultiLanguageProperty': {
      const texts = objects(value.value)
      const text = texts.find(entry => entry.language === 'en') ?? texts[0]
      return typeof text?.text === 'string' ? truncate(text.text) : null
    }
    case 'Range': {
      return value.min === undefined && value.max === undefined ? null : `${value.min ?? '…'} – ${value.max ?? '…'}`
    }
    case 'File':
    case 'Blob': {
      return typeof value.contentType === 'string' ? value.contentType : null
    }
    case 'ReferenceElement': {
      const keys = isObject(value.value) ? objects(value.value.keys) : []
      const last = keys.at(-1)
      return typeof last?.value === 'string' ? truncate(last.value) : null
    }
    default: {
      return null
    }
  }
}

export function toElementNode (child: Child): ElementNode {
  const key = encodeKey(formatLocator(child.steps))
  if (child.variableGroup) {
    return {
      key,
      label: child.label,
      modelType: 'OperationVariables',
      variableGroup: child.variableGroup,
      semanticId: null,
      preview: null,
      hasChildren: Array.isArray(child.value) && child.value.length > 0,
    }
  }
  const value = isObject(child.value) ? child.value : {}
  return {
    key,
    label: child.label,
    modelType: typeof value.modelType === 'string' ? value.modelType : 'Unknown',
    variableGroup: null,
    semanticId: firstKeyValue(value.semanticId),
    preview: preview(value),
    hasChildren: childrenOf(value, child.steps).length > 0,
  }
}
