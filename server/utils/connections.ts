import type { ConnectionCallWireParams } from '#shared/contract'
import type { AppCall } from './apps'
import type { StudioRuntime } from './studio'
import { installationConnectionApis } from '../lib/apps/connections'
import { callHttpConnection, CallLimiter } from '../lib/connections/http'
import { getInfrastructure } from '../lib/infrastructures'
import { isWorkspaceId } from '../lib/workspaces/manager'

/** Calls in flight per session and connection, for this process (K7). */
const limiter = new CallLimiter()

/**
 * Runs `studio.connections.call` (ADR 0047) for a frame or a backend: the
 * infrastructure is the one of the call's target; a workspace or a frame
 * without a target has none, so its calls are refused as unbound.
 */
export async function performConnectionCall (studio: StudioRuntime, call: AppCall, params: ConnectionCallWireParams, requestId: string): Promise<unknown> {
  const record = call.targetId && !isWorkspaceId(call.targetId) ? await getInfrastructure(studio, call.targetId) : null
  return callHttpConnection(studio, studio.broker, limiter, {
    actor: call.actor,
    installation: call.installation,
    apis: await installationConnectionApis(studio, call.installation),
    record,
    caller: call.caller,
    requestId,
    params,
  })
}
