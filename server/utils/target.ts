import type { AuthenticationState, Target } from '#shared/contract'
import type { Actor } from '../lib/deps'
import type { InfrastructureRecord } from '../lib/infrastructures'
import type { AasTarget } from '../lib/targets/aas-target'
import type { RequestEvent } from 'nuxt/server'
import { recordAudit } from '../lib/audit'
import { getInfrastructure, targetPolicy } from '../lib/infrastructures'
import { LiveAasTarget } from '../lib/targets/live-target'
import { requireActor } from './auth'
import { requestIdOf, routeParam } from './handler'
import { useStudio } from './studio'

export interface OpenedTarget {
  actor: Actor
  target: AasTarget
  /** Records the outcome of a write in the audit log. */
  auditWrite: (outcome: 'success' | 'failure', details: Record<string, unknown>) => Promise<void>
}

/**
 * Resolves the `targetId` route parameter for the signed-in user: a live
 * infrastructure with the credentials of this user and target. Route
 * handlers only see the `AasTarget` interface.
 */
export async function openTarget (event: RequestEvent): Promise<OpenedTarget> {
  const actor = await requireActor(event)
  const studio = await useStudio()
  const record = await getInfrastructure(studio, routeParam(event, 'targetId'))
  const access = await studio.broker.access(record, actor.sessionId)
  const audit = (action: string, outcome: 'success' | 'failure', details: Record<string, unknown>) => recordAudit(studio, {
    action,
    outcome,
    requestId: requestIdOf(event),
    actorSubject: actor.subject,
    targetId: record.id,
    downstreamIdentity: access.downstreamIdentity,
    details: { route: event.url.pathname, ...details },
  })

  if (event.req.method === 'GET' && record.security.mode === 'deployment_client_credentials') {
    // The target only sees Studio's identity, so Studio records who read.
    await audit('target.read', 'success', {})
  }

  return {
    actor,
    auditWrite: (outcome, details) => audit('target.write', outcome, details),
    target: new LiveAasTarget({
      record,
      access,
      policy: targetPolicy(studio, record),
      requestId: requestIdOf(event),
      onUnauthorized: () => studio.broker.invalidate(record, actor.sessionId),
    }),
  }
}

export function toTarget (record: InfrastructureRecord, authenticationState: AuthenticationState): Target {
  return {
    id: record.id,
    kind: 'live',
    name: record.name,
    description: record.description,
    securityMode: record.security.mode,
    authenticationState,
    capabilities: { write: true, persistence: 'immediate' },
    workspace: null,
  }
}
