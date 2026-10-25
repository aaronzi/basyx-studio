import type { CopyReport } from '#shared/contract'
import { getRequestHeader } from 'nuxt/server'
import { executeCopy } from '~~/server/lib/copies/execute'
import { StudioProblem } from '~~/server/lib/problem'
import { requireActor, requireCsrf } from '~~/server/utils/auth'
import { openCopyTarget } from '~~/server/utils/copies'
import { defineStudioHandler, readValidated, routeParam } from '~~/server/utils/handler'
import { useStudio } from '~~/server/utils/studio'
import { copyExecutionSchema } from '#shared/contract'

/**
 * Runs a copy plan with the policy the user confirmed (K5 to K8). Source
 * and destination are opened again, so their rights are checked now. The
 * same `Idempotency-Key` answers with the first report; running the plan
 * again skips what an earlier run wrote (DATA-015).
 */
export default defineStudioHandler(async (event): Promise<CopyReport> => {
  await requireCsrf(event)
  const studio = await useStudio()
  const actor = await requireActor(event)
  const record = studio.copies.get(routeParam(event, 'copyPlanId'), actor.subject)
  const execution = await readValidated(event, copyExecutionSchema)
  const idempotencyKey = getRequestHeader(event, 'idempotency-key')?.slice(0, 200)
  const repeated = idempotencyKey ? record.reports.get(idempotencyKey) : undefined
  if (repeated) {
    return repeated
  }
  if (!record.plan.allowedCollisionPolicies.includes(execution.collisionPolicy)) {
    throw new StudioProblem('invalid_request', 'The plan does not allow this collision policy.')
  }
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
  if (idempotencyKey) {
    record.reports.set(idempotencyKey, report)
  }
  return report
})
