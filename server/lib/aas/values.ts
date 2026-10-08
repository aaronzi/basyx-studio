import type { EditableModelType, ElementValueInput } from '#shared/contract'
import type { JsonObject } from './outline'
import type { types } from '@aas-core-works/aas-core3.1-typescript'
import { jsonization, verification } from '@aas-core-works/aas-core3.1-typescript'
import { editableModelTypes } from '#shared/contract'
import { StudioProblem } from '../problem'

export function editableModelType (element: JsonObject): EditableModelType | null {
  const modelType = element.modelType
  return (editableModelTypes as readonly unknown[]).includes(modelType) ? modelType as EditableModelType : null
}

/**
 * Returns the element with a new value, validated with AAS Core. Only
 * `Property` and `MultiLanguageProperty` values can be changed.
 */
export function withValue (element: JsonObject, value: ElementValueInput['value']): { json: JsonObject, instance: types.ISubmodelElement } {
  const modelType = editableModelType(element)
  if (!modelType) {
    throw new StudioProblem('unsupported_operation', `Values of ${String(element.modelType)} elements cannot be edited.`)
  }

  const json: JsonObject = { ...element }
  if (modelType === 'Property') {
    if (Array.isArray(value)) {
      throw new StudioProblem('invalid_request', 'A Property value is a string.')
    }
    if (value === null) {
      delete json.value
    } else {
      json.value = value
    }
  } else {
    if (!Array.isArray(value)) {
      throw new StudioProblem('invalid_request', 'A MultiLanguageProperty value is a list of language strings.')
    }
    if (value.length === 0) {
      delete json.value
    } else {
      json.value = value.map(entry => ({ language: entry.language, text: entry.text }))
    }
  }

  const parsed = jsonization.submodelElementFromJsonable(json as jsonization.JsonValue)
  if (parsed.error) {
    throw new StudioProblem('validation_failed', parsed.error.message, {
      violations: [{ path: parsed.error.path.toString(), message: parsed.error.message }],
    })
  }
  const instance = parsed.mustValue()
  // Verifies the element including its language strings, qualifiers and
  // references; the rest of the submodel is unchanged.
  const violations = [...verification.verify(instance)]
    .map(error => ({ path: error.path.toString(), message: error.message }))
  if (violations.length > 0) {
    throw new StudioProblem('validation_failed', violations[0]!.message, { violations })
  }
  return { json: jsonization.toJsonable(instance) as JsonObject, instance }
}
