import type { CopyExecution, CopyReport } from '#shared/contract'
import type { RequestEvent } from 'nuxt/server'
import type { StoredCopyPlan } from '~~/server/lib/copies/store'
import { getRequestHeader } from 'nuxt/server'
import { executeCopy } from '~~/server/lib/copies/execute'
import { StudioProblem } from '~~/server/lib/problem'
import { requireActor, requireCsrf } from '~~/server/utils/auth'
import { openCopyTarget } from '~~/server/utils/copies'
import { defineStudioHandler, readValidated, routeParam } from '~~/server/utils/handler'
import { useStudio } from '~~/server/utils/studio'
import { copyExecutionSchema } from '#shared/contract'

/** As the API documents it (`IdempotencyKey`). */
const idempotencyKeyPattern = /^[\w.:-]{16,200}$/

/**
 * Runs a copy plan with the policy the user confirmed (K5 to K8). Source
 * and destination are opened again, so their rights are checked now. The
 * same `Idempotency-Key` answers with the first report, also while that
 * execution runs; running the plan again skips what an earlier run wrote
 * and completes what it left open (DATA-015).
 */
export default defineStudioHandler(async (event): Promise<CopyReport> => {
  await requireCsrf(event)
  const studio = await useStudio()
  const actor = await requireActor(event)
  const record = studio.copies.get(routeParam(event, 'copyPlanId'), actor.subject)
  const idempotencyKey = getRequestHeader(event, 'idempotency-key') ?? ''
  if (!idempotencyKeyPattern.test(idempotencyKey)) {
    throw new StudioProblem('invalid_request', 'An Idempotency-Key header of 16 to 200 characters (letters, digits, . _ : -) is required.')
  }
  const execution = await readValidated(event, copyExecutionSchema)
  // Looked up and registered with no await in between: a repeated request
  // shares the execution, also while it still runs.
  const known = record.executions.get(idempotencyKey)
  if (known) {
    return known
  }
  if (!record.plan.allowedCollisionPolicies.includes(execution.collisionPolicy)) {
    throw new StudioProblem('invalid_request', 'The plan does not allow this collision policy.')
  }
  // Executions of one plan share its run, so each waits for the one before.
  const running = record.tail.catch(() => {}).then(() => execute(event, record, execution))
  record.executions.set(idempotencyKey, running)
  record.tail = running
  try {
    return await running
  } catch (error) {
    // A failed execution may be retried with the same key.
    record.executions.delete(idempotencyKey)
    throw error
  }
})

async function execute (event: RequestEvent, record: StoredCopyPlan, execution: CopyExecution): Promise<CopyReport> {
  const studio = await useStudio()
  const destination = await openCopyTarget(event, record.plan.destinationTargetId, 'destination', record.destinationShellId ?? undefined)
  const shellRoot = record.roots.find(root => root.type === 'shell')
  const reader = record.source.kind === 'target'
    ? (await openCopyTarget(event, record.source.targetId, 'source', shellRoot?.id)).target
    : record.source.reader
  const details = { operation: 'copy', planId: record.plan.id, sourceTargetId: record.plan.sourceTargetId, policy: execution.collisionPolicy }
  let report: CopyReport
  try {
    report = await executeCopy(
      {
        reader,
        destination: destination.target,
        scheme: destination.idScheme,
        sync: await destination.syncPlan(),
        dependencies: record.dependencies,
        destinationShellId: record.destinationShellId,
        filesAllowed: studio.config.deployment.uploads,
        revisions: record.revisions,
      },
      record.plan.id,
      record.plan.resources,
      execution.collisionPolicy,
      new Set(execution.exclude),
      record.run,
    )
  } catch (error) {
    await destination.auditWrite('failure', { ...details, code: error instanceof StudioProblem ? error.code : 'internal_error' })
    throw error
  }
  await destination.auditWrite(report.status === 'failed' ? 'failure' : 'success', { ...details, counts: report.counts })
  return report
}
