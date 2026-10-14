import type { AuthenticationState, Target } from '#shared/contract'
import type { Actor } from '../lib/deps'
import type { InfrastructureRecord } from '../lib/infrastructures'
import type { AasTarget, DetectedFeatures } from '../lib/targets/aas-target'
import type { RequestEvent } from 'nuxt/server'
import { recordAudit } from '../lib/audit'
import { getInfrastructure, targetPolicy } from '../lib/infrastructures'
import { StudioProblem } from '../lib/problem'
import { liveCapabilities, noDetectedFeatures } from '../lib/targets/capabilities'
import { LiveAasTarget } from '../lib/targets/live-target'
import { isWorkspaceId } from '../lib/workspaces/manager'
import { requireActor } from './auth'
import { requireWorkspaces } from './desktop'
import { requestIdOf, routeParam } from './handler'
import { useStudio } from './studio'

export interface OpenedTarget {
  actor: Actor
  target: AasTarget
  /** Detects the optional features (cached); `null` for targets without any. */
  detect: (() => Promise<DetectedFeatures>) | null
  /** Records the outcome of a write in the audit log. */
  auditWrite: (outcome: 'success' | 'failure', details: Record<string, unknown>) => Promise<void>
}

/** Who opens which target, for what; the audit records come from this. */
export interface TargetAccess {
  actor: Actor
  targetId: string
  requestId: string
  /** The Studio route or capability method, for the audit log. */
  operation: string
  /** Reads of client-credentials targets are audited, because the target only sees Studio. */
  read: boolean
  /** Set when an app calls on the user's behalf (ADR 0018). */
  appInstallationId?: string
}

/**
 * Opens a target for a user: a live infrastructure with the credentials of
 * this user and target, or a desktop workspace. Callers only see the
 * `AasTarget` interface.
 */
export async function openTargetFor (access: TargetAccess): Promise<OpenedTarget> {
  const { actor, targetId, requestId } = access
  const studio = await useStudio()
  const appInstallationId = access.appInstallationId ?? null

  if (isWorkspaceId(targetId)) {
    return {
      actor,
      target: requireWorkspaces(studio).target(targetId),
      detect: null,
      auditWrite: (outcome, details) => recordAudit(studio, {
        action: 'workspace.write',
        outcome,
        requestId,
        actorSubject: actor.subject,
        targetId,
        appInstallationId,
        details,
      }),
    }
  }

  const record = await getInfrastructure(studio, targetId)
  const grant = await studio.broker.access(record, actor.sessionId)
  const audit = (action: string, outcome: 'success' | 'failure', details: Record<string, unknown>) => recordAudit(studio, {
    action,
    outcome,
    requestId,
    actorSubject: actor.subject,
    targetId: record.id,
    downstreamIdentity: grant.downstreamIdentity,
    appInstallationId,
    details: { route: access.operation, ...details },
  })

  if (access.read && record.security.mode === 'deployment_client_credentials') {
    // The target only sees Studio's identity, so Studio records who read.
    await audit('target.read', 'success', {})
  }

  const target = new LiveAasTarget({
    record,
    access: grant,
    policy: targetPolicy(studio, record),
    requestId,
    onUnauthorized: () => studio.broker.invalidate(record, actor.sessionId),
    detected: studio.features.peek(record),
  })
  return {
    actor,
    auditWrite: (outcome, details) => audit('target.write', outcome, details),
    target,
    detect: () => studio.features.get(record, () => target.detectFeatures()),
  }
}

/** Opens the target of the `targetId` route parameter for the signed-in user. */
export async function openTarget (event: RequestEvent): Promise<OpenedTarget> {
  return openTargetFor({
    actor: await requireActor(event),
    targetId: routeParam(event, 'targetId'),
    requestId: requestIdOf(event),
    operation: event.url.pathname,
    read: event.req.method === 'GET',
  })
}

export function toTarget (record: InfrastructureRecord, authenticationState: AuthenticationState, detected: DetectedFeatures | null): Target {
  return {
    id: record.id,
    kind: 'live',
    name: record.name,
    description: record.description,
    securityMode: record.security.mode,
    authenticationState,
    capabilities: liveCapabilities(record, detected),
    workspace: null,
  }
}

/**
 * The optional features of a live target, detected with the user's
 * credentials and cached per infrastructure. Detection never fails the
 * caller: an unreachable or unauthorized target simply has none (yet).
 */
export async function detectedFeatures (access: Omit<TargetAccess, 'operation' | 'read'>): Promise<DetectedFeatures> {
  const studio = await useStudio()
  const record = await getInfrastructure(studio, access.targetId)
  try {
    return await studio.features.get(record, async () => {
      const { target } = await openTargetFor({ ...access, operation: 'feature-detection', read: false })
      return target.detectFeatures()
    })
  } catch {
    return noDetectedFeatures
  }
}

type FlagCapability = Exclude<keyof Target['capabilities'], 'persistence' | 'search'>

/**
 * Fails unless the target supports a capability, before any downstream
 * request. Optional features are detected first if they are not known yet.
 */
export async function requireCapability (opened: OpenedTarget, capability: FlagCapability): Promise<void> {
  if (opened.target.capabilities[capability]) {
    return
  }
  if (opened.detect && capability in noDetectedFeatures) {
    const features = await opened.detect()
    if (features[capability as keyof DetectedFeatures]) {
      return
    }
  }
  throw new StudioProblem('unsupported_operation', 'This target does not support this operation.')
}
