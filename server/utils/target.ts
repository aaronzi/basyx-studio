import type { AuthenticationState, Target } from '#shared/contract'
import type { Actor } from '../lib/deps'
import type { InfrastructureRecord } from '../lib/infrastructures'
import type { H3Event } from 'h3'
import { recordAudit } from '../lib/audit'
import { getInfrastructure, targetPolicy } from '../lib/infrastructures'
import { LiveAasTarget } from '../lib/targets/live-target'

export interface OpenedTarget {
  actor: Actor
  record: InfrastructureRecord
  target: LiveAasTarget
}

/**
 * Resolves the `targetId` route parameter for the signed-in user and returns
 * an SDK-backed target with the credentials of this user and target.
 */
export async function openTarget (event: H3Event): Promise<OpenedTarget> {
  const actor = await requireActor(event)
  const studio = await useStudio()
  const record = await getInfrastructure(studio, routeParam(event, 'targetId'))
  const access = await studio.broker.access(record, actor.sessionId)

  if (record.security.mode === 'deployment_client_credentials') {
    // The target only sees Studio's identity, so Studio records who acted.
    await recordAudit(studio, {
      action: 'target.read',
      outcome: 'success',
      requestId: requestIdOf(event),
      actorSubject: actor.subject,
      targetId: record.id,
      downstreamIdentity: access.downstreamIdentity,
      details: { route: event.path.split('?', 1)[0] },
    })
  }

  return {
    actor,
    record,
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
  }
}
