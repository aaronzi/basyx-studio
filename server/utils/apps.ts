import type { AppMethodName } from '#shared/contract'
import type { AppCaller, AppCallMode } from '../lib/apps/calls'
import type { AppInstallationRecord } from '../lib/apps/store'
import type { Actor } from '../lib/deps'
import type { StudioRuntime } from './studio'
import type { Methods } from '@basyx/studio-sdk/protocol'
import type { RequestEvent } from 'nuxt/server'
import { appMethodParamsSchemas } from '#shared/contract'
import { authorizeAppCall, checkShellToOpen, executeAasMethod, isAasMethod, isContainerMethod, isWriteMethod, requireInstalledRevision } from '../lib/apps/calls'
import { listAppFilePaths, readAppFiles } from '../lib/apps/store'
import { issueCapabilityToken } from '../lib/apps/tokens'
import { recordAudit } from '../lib/audit'
import { StudioProblem } from '../lib/problem'
import { performContainerMethod } from './containers'
import { requestIdOf } from './handler'
import { useStudio } from './studio'
import { openTargetFor, requireFileUploads } from './target'
import { performTimeSeriesRead } from './timeseries'

export function requireAppsBaseUrl (studio: StudioRuntime): string {
  if (!studio.config.apps.baseUrl) {
    throw new StudioProblem('unsupported_operation', 'Apps need a separate apps origin (STUDIO_APPS_URL).')
  }
  return studio.config.apps.baseUrl
}

export interface AppCall {
  caller: AppCaller
  actor: Actor
  installation: AppInstallationRecord
  /** The target the frame or token is bound to. */
  targetId: string | null
  /** The shell the frame shows, if any. */
  shellId?: string | null
  /** The package digest the caller runs; see `requireInstalledRevision`. */
  digest?: string
  /** Studio's mode for the call; structural writes need `edit` (MVP-7 A1). */
  mode: AppCallMode
  method: AppMethodName
  params: unknown
}

const backendModule = /\.(?:js|mjs|json|wasm)$/

/**
 * Executes a capability call (ADR 0018): the installed manifest must declare
 * the method's permission, and the target applies the user's own rights.
 * Refusals and writes are audited with the app identity. UI methods are
 * only authorized here; the host renderer performs them.
 */
export async function performAppCall (event: RequestEvent, call: AppCall): Promise<unknown> {
  const studio = await useStudio()
  const requestId = requestIdOf(event)
  const { actor, installation, method, targetId } = call
  const auditFailure = (error: unknown) => recordAudit(studio, {
    action: 'app.call',
    outcome: 'failure',
    requestId,
    actorSubject: actor.subject,
    targetId,
    appInstallationId: installation.id,
    details: { appId: installation.appId, method, caller: call.caller, code: error instanceof StudioProblem ? error.code : 'internal_error' },
  })

  try {
    requireInstalledRevision(installation, call.digest)
    authorizeAppCall(installation, method, call.caller, studio.config.apps.trustStore, call.mode)
    if (method === 'studio.aas.putAttachment') {
      // The upload route's switch (STUDIO_ALLOW_UPLOADS); its size limit applies with the parameters.
      await requireFileUploads()
    }
  } catch (error) {
    await auditFailure(error)
    throw error
  }

  const parsed = appMethodParamsSchemas[method].safeParse(call.params ?? {})
  if (!parsed.success) {
    throw new StudioProblem('invalid_request', `Invalid parameters for ${method}.`, {
      violations: parsed.error.issues.map(issue => ({ path: issue.path.join('.'), message: issue.message })),
    })
  }
  const params = parsed.data as Record<string, unknown>
  if (params.data instanceof Uint8Array && params.data.byteLength > studio.config.uploadMaxBytes) {
    throw new StudioProblem('invalid_request', `The file is larger than ${Math.round(studio.config.uploadMaxBytes / 1024 / 1024)} MiB.`)
  }

  if (method === 'studio.backend.call') {
    return callBackend(studio, call, params as { method: string, params?: unknown })
  }
  if (isContainerMethod(method)) {
    try {
      return await performContainerMethod(studio, actor, method, params, requestId)
    } catch (error) {
      await auditFailure(error)
      throw error
    }
  }
  if (method === 'studio.timeseries.read') {
    return performTimeSeriesRead(studio, call, params as never, requestId)
  }
  if (!isAasMethod(method) && method !== 'studio.ui.openShell') {
    return null
  }
  if (!targetId) {
    throw new StudioProblem('invalid_request', 'This app frame is not bound to a target.')
  }
  if (method === 'studio.ui.openShell') {
    const shell = params as Methods['studio.ui.openShell']['params']
    const opened = await openTargetFor({ actor, targetId, requestId, operation: method, read: true, appInstallationId: installation.id, shellId: shell.shellId })
    await checkShellToOpen(opened.target, shell)
    return null
  }

  const opened = await openTargetFor({
    actor,
    targetId,
    requestId,
    operation: method,
    read: !isWriteMethod(method),
    appInstallationId: installation.id,
    shellId: call.shellId ?? undefined,
  })
  const context = { target: opened.target, idScheme: opened.idScheme, syncPlan: opened.syncPlan }
  if (!isWriteMethod(method)) {
    return executeAasMethod(context, method, params as never)
  }
  const details = writeDetails(installation.appId, method, params)
  let result: unknown
  try {
    result = await executeAasMethod(context, method, params as never)
    await opened.auditWrite('success', { ...details, ...resultDetails(method, result) })
  } catch (error) {
    // A write over several resources that failed half-way names what it wrote.
    const written = error instanceof StudioProblem ? writtenIds(error.steps ?? []) : {}
    await opened.auditWrite('failure', { ...details, ...written, code: error instanceof StudioProblem ? error.code : 'internal_error' })
    throw error
  }
  // Registries and discovery that Studio keeps in step: a failed step is reported, not thrown (I5).
  const steps = (result as { steps?: Array<{ outcome: string }> } | null)?.steps ?? []
  if (steps.some(step => step.outcome === 'failed')) {
    await opened.auditWrite('failure', { ...details, operation: 'sync', failed: steps.filter(step => step.outcome === 'failed').length })
  }
  return result
}

/** What the audit log records of an app's write: what it changed, never the content. */
function writeDetails (appId: string, method: AppMethodName, params: Record<string, unknown>): Record<string, unknown> {
  const details: Record<string, unknown> = { appId, method }
  for (const key of ['shellId', 'submodelId', 'idShortPath', 'parentPath', 'fileName', 'contentType', 'removeReferences', 'deleteSubmodels'] as const) {
    if (params[key] !== undefined) {
      details[key === 'idShortPath' ? 'path' : key] = params[key]
    }
  }
  if (params.data instanceof Uint8Array) {
    details.size = params.data.byteLength
  }
  return details
}

/**
 * What a successful write produced, for the audit log: the identifiers of
 * new shells and submodels, which Studio may have generated (ADR 0028), and
 * an element's path after it was added or renamed.
 */
function resultDetails (method: AppMethodName, result: unknown): Record<string, unknown> {
  const value = (result ?? {}) as { shell?: { id?: unknown }, submodelId?: unknown, idShortPath?: unknown, steps?: Array<{ resource: string, id: string, outcome: string }> }
  switch (method) {
    case 'studio.aas.createShell': {
      const { createdSubmodelIds } = writtenIds(value.steps ?? [])
      return { shellId: value.shell?.id, ...(createdSubmodelIds ? { createdSubmodelIds } : {}) }
    }
    case 'studio.aas.createSubmodel': {
      return { submodelId: value.submodelId }
    }
    case 'studio.aas.addElement':
    case 'studio.aas.putElement': {
      return { resultPath: value.idShortPath }
    }
    default: {
      return {}
    }
  }
}

/** The shells and submodels a write over several resources wrote, from its steps. */
function writtenIds (steps: Array<{ resource: string, id: string, outcome: string }>): { createdShellIds?: string[], createdSubmodelIds?: string[] } {
  const ids = (resource: string) => steps.filter(step => step.resource === resource && step.outcome === 'written').map(step => step.id)
  const written = { createdShellIds: ids('shell'), createdSubmodelIds: ids('submodel') }
  return Object.fromEntries(Object.entries(written).filter(([, list]) => list.length > 0))
}

async function callBackend (studio: StudioRuntime, call: AppCall, params: { method: string, params?: unknown }): Promise<unknown> {
  const { installation } = call
  const backend = installation.manifest.backend
  if (!backend || !studio.backends) {
    throw new StudioProblem('app_backend_unavailable', `${installation.appId} has no backend.`)
  }
  const token = issueCapabilityToken(studio.capabilityKey, {
    installationId: installation.id,
    digest: installation.digest,
    sessionId: call.actor.sessionId,
    targetId: call.targetId,
    mode: call.mode,
  })
  return studio.backends.call(installation.id, async () => {
    const paths = (await listAppFilePaths(studio, installation.id)).filter(path => backendModule.test(path))
    return { installationId: installation.id, appId: installation.appId, entry: backend.entry, files: await readAppFiles(studio, installation.id, paths) }
  }, params.method, params.params, token)
}
