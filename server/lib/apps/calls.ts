import type { AppMethodName, AppPermission } from '#shared/contract'
import type { AasTarget } from '../targets/aas-target'
import type { AppInstallationRecord } from './store'
import type { TrustStore } from './trust'
import type { Methods } from '@basyx/studio-sdk/protocol'
import { methodPermissions } from '#shared/contract'
import { parseLocator, splitAddressable } from '../aas/keys'
import { resolveSubmodelRefs } from '../aas/submodel-refs'
import { StudioProblem } from '../problem'
import { installationTrust } from './trust'

export type AasMethodName = Extract<AppMethodName, `studio.aas.${string}`>

export function isAasMethod (method: AppMethodName): method is AasMethodName {
  return method.startsWith('studio.aas.')
}

export function isWriteMethod (method: AppMethodName): boolean {
  return method === 'studio.aas.setElementValue'
}

/** Who makes a call: the host bridge for a frame, or a backend with a capability token. */
export type AppCaller = 'host' | 'backend'

/**
 * Refuses a call the installed manifest does not permit (ADR 0018), and every
 * call of a revoked app (ADR 0044). Reserved permissions need more than the
 * manifest: `studio.containers` is held by bundled apps only (ADR 0033),
 * `studio.timeseries.read` also by signed apps whose publisher the trust
 * store grants it. The user's own rights are checked separately, by the
 * target.
 */
export function authorizeAppCall (installation: AppInstallationRecord, method: AppMethodName, caller: AppCaller, trustStore: TrustStore): void {
  const trust = installationTrust(installation, trustStore)
  if (trust.revoked) {
    throw new StudioProblem('app_revoked', `${installation.appId} is no longer trusted: ${trust.revoked === 'keyRemoved' ? 'the key that signed it was removed from the trust store' : 'its publisher may no longer sign this app ID'}.`)
  }
  if (caller === 'backend' && !isAasMethod(method)) {
    throw new StudioProblem('unsupported_operation', `${method} is not available to backend apps.`)
  }
  const permission: AppPermission | null = methodPermissions[method]
  if (permission && !installation.manifest.permissions.includes(permission)) {
    throw new StudioProblem('app_permission_not_declared', `${method} needs the permission ${permission}, which ${installation.appId} did not declare.`)
  }
  if (isContainerMethod(method) && !installation.bundled) {
    throw new StudioProblem('app_permission_not_declared', `${method} is reserved for the apps shipped with Studio.`)
  }
  if (method === 'studio.timeseries.read' && !trust.granted.includes('studio.timeseries.read')) {
    throw new StudioProblem('app_permission_not_declared', `${method} is reserved for the apps shipped with Studio and for signed apps whose publisher the trust store grants it.`)
  }
}

/**
 * Refuses a call from code of another package than the installed one: a
 * frame or backend that was loaded before an in-place update (ADR 0044).
 * Its permissions and trust are those of the version it runs, not of the
 * update.
 */
export function requireInstalledRevision (installation: AppInstallationRecord, digest: string | undefined): void {
  if (digest !== undefined && digest !== installation.digest) {
    throw new StudioProblem('app_outdated', `${installation.appId} was updated to ${installation.version} after this frame was loaded. Reload it.`)
  }
}

export type ContainerMethodName = Extract<AppMethodName, `studio.containers.${string}`>

export function isContainerMethod (method: AppMethodName): method is ContainerMethodName {
  return method.startsWith('studio.containers.')
}

/** An idShortPath of an API-addressable element; operation variables are not. */
function addressable (idShortPath: string): string {
  const { idShortPath: path, rest } = splitAddressable(parseLocator(idShortPath))
  if (rest.length > 0) {
    throw new StudioProblem('unsupported_operation', 'Operation variables cannot be addressed separately.')
  }
  return path
}

/** Runs an AAS capability method on the caller's target. Parameters are already validated. */
export async function executeAasMethod<M extends AasMethodName> (target: AasTarget, method: M, params: Methods[M]['params']): Promise<Methods[M]['result']>
export async function executeAasMethod (target: AasTarget, method: AasMethodName, params: Record<string, any>): Promise<unknown> {
  switch (method) {
    case 'studio.aas.listShells': {
      const page = await target.listShells(params.limit ?? 50, params.cursor)
      return {
        items: page.items.map(({ key: _key, description: _description, ...summary }) => summary),
        page: page.page,
      }
    }
    case 'studio.aas.getShell': {
      return target.shell(params.shellId)
    }
    case 'studio.aas.listSubmodels': {
      const refs = await resolveSubmodelRefs(target, await target.submodelIds(params.shellId))
      // The SDK's shape (studio-sdk/0): the fields are named, so new ones on Studio's own references stay internal.
      return { items: refs.map(ref => ({ id: ref.submodelId, idShort: ref.idShort, semanticId: ref.semanticId, status: ref.status })) }
    }
    case 'studio.aas.getSubmodel': {
      return target.submodel(params.submodelId)
    }
    case 'studio.aas.getElement': {
      const snapshot = await target.element(params.submodelId, addressable(params.idShortPath))
      return { value: snapshot.value, revision: snapshot.revision, concurrency: snapshot.concurrency }
    }
    case 'studio.aas.setElementValue': {
      const snapshot = await target.setElementValue(params.submodelId, addressable(params.idShortPath), params.value, params.revision)
      return { value: snapshot.value, revision: snapshot.revision, concurrency: snapshot.concurrency }
    }
  }
}
