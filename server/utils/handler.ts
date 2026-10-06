import type { Problem } from '#shared/contract'
import type { H3Event } from 'h3'
import type { z } from 'zod'
import { StudioProblem } from '../lib/problem'

export function requestIdOf (event: H3Event): string {
  return (event.context.requestId as string | undefined) ?? 'unknown'
}

function toProblem (event: H3Event, error: unknown): Problem {
  const problem = error instanceof StudioProblem ? error : new StudioProblem('internal_error')
  if (!(error instanceof StudioProblem)) {
    // Log the failure without request data; error messages never contain tokens.
    console.error(`[studio] request ${requestIdOf(event)} failed:`, error)
  }
  return {
    type: 'about:blank',
    title: problem.title,
    status: problem.status,
    code: problem.code,
    detail: problem.detail,
    requestId: requestIdOf(event),
    retryable: problem.retryable,
    violations: problem.violations,
  }
}

/**
 * Wraps a Studio API handler: expected failures become
 * `application/problem+json` with a stable code and the request ID.
 */
export function defineStudioHandler<T> (handler: (event: H3Event) => Promise<T>) {
  return defineEventHandler(async event => {
    try {
      return await handler(event)
    } catch (error) {
      const problem = toProblem(event, error)
      setResponseStatus(event, problem.status)
      setResponseHeader(event, 'Content-Type', 'application/problem+json')
      setResponseHeader(event, 'Cache-Control', 'no-store')
      return problem
    }
  })
}

function violations (error: z.ZodError) {
  return error.issues.map(issue => ({ path: issue.path.join('.'), message: issue.message }))
}

export async function readValidated<T extends z.ZodType> (event: H3Event, schema: T): Promise<z.infer<T>> {
  const body = await readBody(event).catch(() => {
    throw new StudioProblem('invalid_request', 'The request body is not valid JSON.')
  })
  const parsed = schema.safeParse(body ?? {})
  if (!parsed.success) {
    throw new StudioProblem('invalid_request', undefined, { violations: violations(parsed.error) })
  }
  return parsed.data
}

export function queryValidated<T extends z.ZodType> (event: H3Event, schema: T): z.infer<T> {
  const parsed = schema.safeParse(getQuery(event))
  if (!parsed.success) {
    throw new StudioProblem('invalid_request', undefined, { violations: violations(parsed.error) })
  }
  return parsed.data
}

export function routeParam (event: H3Event, name: string): string {
  const value = getRouterParam(event, name, { decode: true })
  if (!value) {
    throw new StudioProblem('invalid_request', `Missing ${name}.`)
  }
  return value
}
