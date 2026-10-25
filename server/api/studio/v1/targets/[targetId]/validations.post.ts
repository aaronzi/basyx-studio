import type { ValidationResult } from '#shared/contract'
import { findings } from '~~/server/lib/aas/edits'
import { checkPastedText, parsePastedElement } from '~~/server/lib/copies/text'
import { StudioProblem } from '~~/server/lib/problem'
import { requireCsrf } from '~~/server/utils/auth'
import { defineStudioHandler, readValidated } from '~~/server/utils/handler'
import { openTarget } from '~~/server/utils/target'
import { validationInputSchema } from '#shared/contract'

/**
 * AAS Core findings for a JSON value, or for AAS JSON or XML text (the
 * *From JSON or XML* dialog): an element comes back as JSON to insert;
 * text for identifiables says what it holds, for the copy plan. Nothing is
 * written.
 */
export default defineStudioHandler(async (event): Promise<ValidationResult> => {
  await requireCsrf(event)
  const input = await readValidated(event, validationInputSchema)
  await openTarget(event)
  if (!('text' in input)) {
    return { violations: findings(input.kind, input.value) }
  }
  try {
    if (input.kind === 'element') {
      const value = parsePastedElement(input.format, input.text)
      return { violations: findings('element', value), value }
    }
    return checkPastedText(input.format, input.text)
  } catch (error) {
    if (error instanceof StudioProblem && error.code === 'invalid_request') {
      return { violations: [{ path: '', message: error.detail ?? error.title }] }
    }
    throw error
  }
})
