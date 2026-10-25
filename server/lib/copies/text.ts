import type { JsonObject } from '../aas/outline'
import { jsonization, types, xmlization } from '@aas-core-works/aas-core3.1-typescript'
import { isElementModelType } from '#shared/aas/defaults'
import { findings } from '../aas/edits'
import { StudioProblem } from '../problem'

/** The environment a pasted text holds, and what it is called in the plan. */
export interface PastedEnvironment {
  environment: JsonObject
  label: string
}

function wrap (value: JsonObject): PastedEnvironment {
  switch (value.modelType) {
    case 'AssetAdministrationShell': {
      return { environment: { assetAdministrationShells: [value] }, label: 'Pasted shell' }
    }
    case 'Submodel': {
      return { environment: { submodels: [value] }, label: 'Pasted submodel' }
    }
    case 'ConceptDescription': {
      return { environment: { conceptDescriptions: [value] }, label: 'Pasted concept description' }
    }
    default: {
      if (typeof value.modelType === 'string') {
        throw new StudioProblem('invalid_request', 'Paste submodel elements into the element tree; a copy here takes shells, submodels, concept descriptions or an environment.')
      }
      return { environment: value, label: 'Pasted environment' }
    }
  }
}

/**
 * AAS JSON or XML from the system clipboard (K9): an environment, or a
 * single shell, submodel or concept description, which becomes one. The
 * resources are verified one by one in the plan.
 */
export function parsePastedText (format: 'json' | 'xml', content: string): PastedEnvironment {
  if (format === 'json') {
    let value: unknown
    try {
      value = JSON.parse(content)
    } catch {
      throw new StudioProblem('invalid_request', 'The text is not valid JSON.')
    }
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new StudioProblem('invalid_request', 'The JSON is not an AAS object.')
    }
    return wrap(value as JsonObject)
  }
  // AAS Core expects the root element first, without the XML declaration.
  const parsed = xmlization.fromXmlString(content.replace(/^\uFEFF/, '').replace(/^\s*<\?xml[^>]*\?>\s*/, ''))
  if (parsed.error) {
    throw new StudioProblem('invalid_request', `The AAS XML is invalid: ${parsed.error.message} (${parsed.error.path.toString()})`)
  }
  const instance = parsed.mustValue()
  if (instance instanceof types.Environment || instance instanceof types.AssetAdministrationShell || instance instanceof types.Submodel || instance instanceof types.ConceptDescription) {
    return wrap(jsonization.toJsonable(instance) as JsonObject)
  }
  throw new StudioProblem('invalid_request', 'Paste submodel elements into the element tree; a copy here takes shells, submodels, concept descriptions or an environment.')
}

/** A submodel element from AAS JSON or XML text, as JSON. */
export function parsePastedElement (format: 'json' | 'xml', content: string): JsonObject {
  let value: unknown
  if (format === 'json') {
    try {
      value = JSON.parse(content)
    } catch {
      throw new StudioProblem('invalid_request', 'The text is not valid JSON.')
    }
  } else {
    const parsed = xmlization.fromXmlString(content.replace(/^\uFEFF/, '').replace(/^\s*<\?xml[^>]*\?>\s*/, ''))
    if (parsed.error) {
      throw new StudioProblem('invalid_request', `The AAS XML is invalid: ${parsed.error.message} (${parsed.error.path.toString()})`)
    }
    value = jsonization.toJsonable(parsed.mustValue())
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value) || !isElementModelType((value as JsonObject).modelType)) {
    throw new StudioProblem('invalid_request', 'The text is not a submodel element.')
  }
  return value as JsonObject
}

/**
 * What a pasted text would add, for the dialog before the copy plan: how
 * many shells, submodels and concept descriptions it holds, and the first
 * AAS Core findings, named by idShort.
 */
export function checkPastedText (format: 'json' | 'xml', content: string): { contents: { shells: number, submodels: number, conceptDescriptions: number }, violations: Array<{ path: string, message: string }> } {
  const { environment } = parsePastedText(format, content)
  const list = (key: string) => (Array.isArray(environment[key]) ? environment[key] as JsonObject[] : [])
  const groups = [
    ['shell', list('assetAdministrationShells')],
    ['submodel', list('submodels')],
    ['conceptDescription', list('conceptDescriptions')],
  ] as const
  const violations = groups.flatMap(([kind, items]) => items.flatMap(item => findings(kind, item)
    .map(finding => ({ path: [String(item.idShort ?? item.id ?? ''), finding.path].filter(Boolean).join(': '), message: finding.message }))))
  return {
    contents: { shells: groups[0][1].length, submodels: groups[1][1].length, conceptDescriptions: groups[2][1].length },
    violations: violations.slice(0, 50),
  }
}
