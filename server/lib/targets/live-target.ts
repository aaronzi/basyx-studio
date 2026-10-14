import type {
  AccessDocument,
  AccessGrant,
  ChangeEvent,
  ChangePage,
  ConceptDescriptionSummary,
  EffectiveRights,
  ElementHit,
  ElementValueInput,
  EndpointType,
  ExportFormat,
  InvitationResult,
  Invocation,
  Page,
  SearchResult,
  ShellSummary,
  TargetCapabilities,
} from '#shared/contract'
import type { JsonObject } from '../aas/outline'
import type { FailureRecorder } from '../network/guarded-fetch'
import type { AasTarget, BinaryContent, ChangesQuery, DetectedFeatures, ElementSnapshot } from './aas-target'
import type { TargetHttpOptions } from './http'
import type { types } from '@aas-core-works/aas-core3.1-typescript'
import type { Configuration } from 'basyx-typescript-sdk'
import { jsonization } from '@aas-core-works/aas-core3.1-typescript'
import { AasDiscoveryClient, AasRepositoryClient, ConceptDescriptionRepositoryClient, SubmodelRepositoryClient } from 'basyx-typescript-sdk'
import {
  elementQuery,
  handleFromLocation,
  invocationBody,
  invocationOutputs,
  rebacProfile,
  shellQuery,
  subjectFilter,
  toAccessGrants,
  toChangeEvent,
  toConceptDescriptionSummary,
  toEffectiveRights,
} from '../aas/basyx-go'
import { submodelIdOf, toShellSummary } from '../aas/shells'
import { elementHits } from '../aas/tree'
import { withValue } from '../aas/values'
import { StudioProblem } from '../problem'
import { liveCapabilities } from './capabilities'
import { isAuthorizationProblem } from './features'
import { encodeIdentifier, TargetHttp } from './http'
import { contentHash, parseRevision, revisionOf } from './revision'

type SdkResult<T>
  = | { success: true, data: T, statusCode?: number, etag?: string }
    | { success: false, error: unknown, statusCode?: number, etag?: string, preconditionFailed?: boolean }

/** Attempts per write when the submodel revision changes between read and write. */
const writeAttempts = 3

/** How long the target may take for an asynchronous operation before giving up. */
const asyncInvocationTimeout = 'PT60S'

const exportMediaTypes: Record<ExportFormat, string> = {
  aasx: 'application/asset-administration-shell-package+xml',
  json: 'application/json',
  xml: 'application/xml',
}

export interface LiveTargetOptions extends TargetHttpOptions {
  /** Optional features detected earlier, if known. */
  detected?: DetectedFeatures | null
}

/**
 * Converts SDK results to plain JSON at the adapter boundary. The SDK bundles
 * its own copy of aas-core, so its instances fail `instanceof` checks against
 * Studio's copy; serialization works because it dispatches through methods.
 */
function toJson (value: types.Class): JsonObject {
  return jsonization.toJsonable(value) as JsonObject
}

function path (idShortPath: string): string {
  return encodeURIComponent(idShortPath)
}

function isUnsupported (error: unknown): boolean {
  return error instanceof StudioProblem
    && ['target_request_rejected', 'target_resource_not_found', 'unsupported_operation'].includes(error.code)
}

/** Maps a value-only operation result to Studio's invocation state. */
function toInvocation (operation: JsonObject, result: JsonObject, handle: string | null): Invocation {
  const state = String(result.executionState ?? 'Completed')
  const messages = Array.isArray(result.messages) ? result.messages as JsonObject[] : []
  const message = messages.map(entry => entry.text).find(text => typeof text === 'string') as string | undefined
  if (state === 'Running' || state === 'Initiated') {
    return { handle, state: 'running', outputs: [], message: message ?? null }
  }
  const failed = state !== 'Completed' || result.success === false
  return { handle, state: failed ? 'failed' : 'completed', outputs: failed ? [] : invocationOutputs(operation, result), message: message ?? (failed ? state : null) }
}

/**
 * Live AAS target, scoped to one request. Uses `basyx-typescript-sdk` for
 * every operation it offers; BaSyx Go endpoints the SDK lacks go through the
 * same guarded, credentialed HTTP layer (ADR 0020).
 */
export class LiveAasTarget implements AasTarget {
  readonly capabilities: TargetCapabilities
  readonly #http: TargetHttp
  readonly #aasClient = new AasRepositoryClient()
  readonly #submodelClient = new SubmodelRepositoryClient()
  readonly #cdClient = new ConceptDescriptionRepositoryClient()
  readonly #discoveryClient = new AasDiscoveryClient()

  constructor (options: LiveTargetOptions) {
    this.#http = new TargetHttp(options)
    this.capabilities = liveCapabilities(options.record, options.detected ?? null)
  }

  /**
   * Probes the optional BaSyx Go features. A feature the server rejects is
   * absent; a probe that could not reach the server or needed authorization
   * fails the detection, so the result is not cached as "absent".
   */
  async detectFeatures (): Promise<DetectedFeatures> {
    const ok = (request: Promise<Response>) => request.then(async response => {
      await response.body?.cancel()
      return response.ok
    }, (error: unknown) => {
      if (isAuthorizationProblem(error) || (error instanceof StudioProblem && error.code === 'target_unreachable')) {
        throw error
      }
      return false
    })
    const passStatuses = [400, 403, 404, 405, 422, 501]
    const [history, changeFeed, sharing] = await Promise.all([
      ok(this.#http.request('submodelRepository', '/submodels/$recent-changes', { query: { limit: 1 }, passStatuses })),
      ok(this.#http.request('aasRepository', '/.well-known/event-feed.json', { passStatuses })),
      this.#http.json<{ profiles?: unknown }>('aasRepository', '/description')
        .then(description => Array.isArray(description.profiles) && description.profiles.includes(rebacProfile), () => false)
        .then(async listed => listed || ok(this.#http.request('aasRepository', '/security/rebac/principal', { passStatuses }))),
    ])
    // Grants and rights are only meaningful when the target sees the user (D15).
    return { history, changeFeed, sharing: sharing && this.#http.securityMode === 'delegated_user' }
  }

  async listShells (limit: number, cursor: string | undefined): Promise<Page<ShellSummary>> {
    const data = await this.#call('aasRepository', configuration =>
      this.#aasClient.getAllAssetAdministrationShells({ configuration, limit, cursor }))
    const nextCursor = data.pagedResult?.cursor ?? null
    return {
      items: data.result.map(shell => toShellSummary(toJson(shell))),
      page: { nextCursor, hasMore: nextCursor !== null },
    }
  }

  async shell (id: string): Promise<JsonObject> {
    return toJson(await this.#call('aasRepository', configuration =>
      this.#aasClient.getAssetAdministrationShellById({ configuration, aasIdentifier: id })))
  }

  /** Submodel identifiers referenced by a shell, across all pages. */
  async submodelIds (shellId: string): Promise<string[]> {
    const ids: string[] = []
    let cursor: string | undefined
    for (let page = 0; page < 20; page++) {
      const data = await this.#call('aasRepository', configuration =>
        this.#aasClient.getAllSubmodelReferencesAasRepository({ configuration, aasIdentifier: shellId, limit: 100, cursor }))
      for (const reference of data.result) {
        const id = submodelIdOf(toJson(reference))
        if (id) {
          ids.push(id)
        }
      }
      cursor = data.pagedResult?.cursor ?? undefined
      if (!cursor) {
        break
      }
    }
    return ids
  }

  async submodelMetadata (id: string): Promise<JsonObject> {
    // `$metadata` responses are plain JSON in the SDK (no aas-core instance).
    return await this.#call('submodelRepository', configuration =>
      this.#submodelClient.getSubmodelByIdMetadata({ configuration, submodelIdentifier: id })) as unknown as JsonObject
  }

  async submodel (id: string): Promise<JsonObject> {
    return toJson(await this.#call('submodelRepository', configuration =>
      this.#submodelClient.getSubmodelById({ configuration, submodelIdentifier: id })))
  }

  async element (submodelId: string, idShortPath: string): Promise<ElementSnapshot> {
    const { value, etag } = await this.#read(submodelId, idShortPath)
    return { value, revision: revisionOf(value), concurrency: etag ? 'strong' : 'best_effort' }
  }

  /**
   * Reads the element again, checks that it still matches the revision the
   * user edited, and writes it. With a downstream ETag the write is
   * conditional, so a change after the check is detected (`strong`); BaSyx Go
   * shares one revision per submodel, so a 412 caused by another element is
   * retried. Without an ETag the check is all there is (`best_effort`).
   */
  async setElementValue (submodelId: string, idShortPath: string, value: ElementValueInput['value'], revision: string): Promise<ElementSnapshot> {
    return this.#conditionalWrite(submodelId, idShortPath, revision, async (current, configuration) => {
      const { instance } = withValue(current.value, value)
      return this.#submodelClient.patchSubmodelElementByPath({
        configuration,
        submodelIdentifier: submodelId,
        idShortPath,
        submodelElement: instance,
        ifMatch: current.etag,
      })
    })
  }

  async deleteShell (id: string): Promise<void> {
    await this.#call('aasRepository', configuration =>
      this.#aasClient.deleteAssetAdministrationShellById({ configuration, aasIdentifier: id }))
  }

  async thumbnail (shellId: string): Promise<BinaryContent | null> {
    const result = await this.#send('aasRepository', configuration =>
      this.#aasClient.getThumbnail({ configuration, aasIdentifier: shellId }))
    if (!result.success) {
      if (result.statusCode === 404) {
        return null
      }
      throw await this.#http.problem(result.statusCode, result.recorder)
    }
    const blob = result.data as Blob
    return { bytes: new Uint8Array(await blob.arrayBuffer()), contentType: blob.type || 'application/octet-stream', fileName: null }
  }

  async attachment (submodelId: string, idShortPath: string): Promise<BinaryContent> {
    const { value } = await this.#read(submodelId, idShortPath)
    if (value.modelType !== 'File') {
      throw new StudioProblem('unsupported_operation', 'Only File elements have an attachment.')
    }
    const blob = await this.#call('submodelRepository', configuration =>
      this.#submodelClient.getFileByPath({ configuration, submodelIdentifier: submodelId, idShortPath })) as Blob
    const location = typeof value.value === 'string' ? value.value : ''
    return {
      bytes: new Uint8Array(await blob.arrayBuffer()),
      contentType: typeof value.contentType === 'string' ? value.contentType : (blob.type || 'application/octet-stream'),
      fileName: location.split('/').pop() || null,
    }
  }

  async replaceAttachment (submodelId: string, idShortPath: string, file: BinaryContent, revision: string): Promise<ElementSnapshot> {
    return this.#conditionalWrite(submodelId, idShortPath, revision, async (current, configuration) => {
      if (current.value.modelType !== 'File') {
        throw new StudioProblem('unsupported_operation', 'Only File elements have an attachment.')
      }
      return this.#submodelClient.putFileByPath({
        configuration,
        submodelIdentifier: submodelId,
        idShortPath,
        fileName: file.fileName ?? 'file',
        file: new Blob([file.bytes as BlobPart], { type: file.contentType }),
        ifMatch: current.etag,
      })
    })
  }

  // The SDK's asynchronous value-only invocation does not expose the
  // `Location` header with the handle, so invocations use the adapter.
  async invoke (submodelId: string, idShortPath: string, args: Array<{ idShort: string, value: string | null }>, async: boolean): Promise<Invocation> {
    const operation = await this.#operation(submodelId, idShortPath)
    const base = `/submodels/${encodeIdentifier(submodelId)}/submodel-elements/${path(idShortPath)}`
    if (!async) {
      const result = await this.#http.json<JsonObject>('submodelRepository', `${base}/invoke/$value`, {
        method: 'POST',
        body: invocationBody(operation, args),
      })
      return toInvocation(operation, result, null)
    }
    const response = await this.#http.request('submodelRepository', `${base}/invoke-async/$value`, {
      method: 'POST',
      body: invocationBody(operation, args, asyncInvocationTimeout),
    })
    await response.body?.cancel()
    const handle = handleFromLocation(response.headers.get('location'))
    if (!handle) {
      throw new StudioProblem('target_invalid_response', 'The target did not return a handle for the asynchronous invocation.')
    }
    return { handle, state: 'running', outputs: [], message: null }
  }

  async invocation (submodelId: string, idShortPath: string, handle: string): Promise<Invocation> {
    const operation = await this.#operation(submodelId, idShortPath)
    const base = `/submodels/${encodeIdentifier(submodelId)}/submodel-elements/${path(idShortPath)}`
    const status = await this.#http.json<JsonObject>('submodelRepository', `${base}/operation-status/${encodeURIComponent(handle)}`)
    const state = toInvocation(operation, status, handle)
    if (state.state !== 'completed') {
      return state
    }
    const result = await this.#http.json<JsonObject>('submodelRepository', `${base}/operation-results/${encodeURIComponent(handle)}/$value`)
    return toInvocation(operation, result, handle)
  }

  async conceptDescriptions (limit: number, cursor: string | undefined): Promise<Page<ConceptDescriptionSummary>> {
    const data = await this.#call('conceptDescriptionRepository', configuration =>
      this.#cdClient.getAllConceptDescriptions({ configuration, limit, cursor }))
    const nextCursor = data.pagedResult?.cursor ?? null
    return {
      items: data.result.map(cd => toConceptDescriptionSummary(toJson(cd))),
      page: { nextCursor, hasMore: nextCursor !== null },
    }
  }

  /**
   * Shells by idShort, ID or global asset ID through the AAS Query Language.
   * AAS environments also find submodel elements by idShort. A target without
   * query support yields no results instead of an error.
   */
  async search (text: string, limit: number): Promise<SearchResult> {
    const query = (type: EndpointType, resource: string, body: JsonObject, size: number) =>
      this.#http.json<{ result?: JsonObject[] }>(type, `/query/${resource}`, { method: 'POST', query: { limit: size }, body })
        .then(page => page.result ?? [], error => {
          if (isUnsupported(error)) {
            return []
          }
          throw error
        })

    const [shells, elementShells, submodels] = await Promise.all([
      query('aasRepository', 'shells', shellQuery(text), limit),
      this.capabilities.search === 'elements' ? query('aasEnvironment', 'shells', elementQuery(text), 50) : Promise.resolve([]),
      this.capabilities.search === 'elements' ? query('aasEnvironment', 'submodels', elementQuery(text), limit) : Promise.resolve([]),
    ])

    const owner = new Map<string, { key: string, label: string }>()
    for (const shell of elementShells) {
      const summary = toShellSummary(shell)
      for (const reference of Array.isArray(shell.submodels) ? shell.submodels as JsonObject[] : []) {
        const id = submodelIdOf(reference)
        if (id && !owner.has(id)) {
          owner.set(id, { key: summary.key, label: summary.idShort ?? summary.id })
        }
      }
    }
    const elements: ElementHit[] = submodels
      .flatMap(submodel => elementHits(submodel, text, limit, owner.get(String(submodel.id)) ?? null))
      .slice(0, limit * 2)
    return { shells: shells.map(shell => toShellSummary(shell)), elements }
  }

  /**
   * Shells registered for an asset ID in the discovery service. Shells that
   * are not registered there are found by their global asset ID.
   */
  async lookupShells (assetId: string): Promise<ShellSummary[]> {
    let ids: string[] = []
    if (this.capabilities.discovery) {
      const data = await this.#call('discovery', configuration =>
        this.#discoveryClient.getAllAssetAdministrationShellIdsByAssetLink({ configuration, assetIds: [{ name: 'globalAssetId', value: assetId }], limit: 20 }))
      ids = data.result
    }
    if (ids.length === 0) {
      const matches = await this.#http.json<{ result?: JsonObject[] }>('aasRepository', '/query/shells', {
        method: 'POST',
        query: { limit: 20 },
        body: { $condition: { $eq: [{ $field: '$aas#assetInformation.globalAssetId' }, { $strVal: assetId }] } },
      }).then(page => page.result ?? [], error => {
        if (isUnsupported(error)) {
          return []
        }
        throw error
      })
      return matches.map(shell => toShellSummary(shell))
    }
    const shells = await Promise.allSettled(ids.map(id => this.shell(id)))
    return shells.filter(result => result.status === 'fulfilled').map(result => toShellSummary(result.value))
  }

  /**
   * The SDK's serialization call cannot choose the format (Accept header).
   * BaSyx Go adds the shell's submodels itself and skips dangling
   * references, which an explicit `submodelIds` list would fail on.
   */
  async exportShell (shellId: string, format: ExportFormat): Promise<BinaryContent> {
    const response = await this.#http.request('aasEnvironment', '/serialization', {
      query: {
        aasIds: encodeIdentifier(shellId),
        includeConceptDescriptions: true,
      },
      headers: { Accept: exportMediaTypes[format] },
    })
    return {
      bytes: new Uint8Array(await response.arrayBuffer()),
      contentType: exportMediaTypes[format],
      fileName: null,
    }
  }

  async upload (file: BinaryContent): Promise<void> {
    const form = new FormData()
    form.append('file', new Blob([file.bytes as BlobPart], { type: file.contentType }), file.fileName ?? 'upload')
    if (file.fileName) {
      form.append('fileName', file.fileName)
    }
    const response = await this.#http.request('aasEnvironment', '/upload', { method: 'POST', body: form })
    await response.body?.cancel()
  }

  async submodelAt (id: string, date: string): Promise<JsonObject> {
    return this.#http.json<JsonObject>('submodelRepository', `/submodels/${encodeIdentifier(id)}/$history`, { query: { date } })
  }

  /**
   * Change events, newest first. Without `after`, it pages through the
   * events since `since` and keeps the newest `limit`; with `after` it returns
   * only events newer than that event.
   */
  async changes (query: ChangesQuery): Promise<ChangePage> {
    const filter = query.subjects?.length ? subjectFilter(query.subjects) : undefined
    const collected: ChangeEvent[] = []
    let cursor: string | undefined
    for (let page = 0; page < 10; page++) {
      const data = await this.#http.json<{ records?: JsonObject[], cursor?: string }>('aasRepository', '/events', {
        query: {
          limit: 200,
          presentation: 'COMPACT',
          filter,
          cursor,
          lastEventId: cursor ? undefined : query.after,
          since: cursor || query.after ? undefined : query.since,
        },
      })
      for (const record of data.records ?? []) {
        const event = toChangeEvent(record)
        if (event) {
          collected.push(event)
        }
      }
      cursor = data.cursor
      if (!cursor || (data.records ?? []).length === 0) {
        break
      }
    }
    const items = collected.toReversed().slice(0, query.limit)
    return { items, lastEventId: collected.at(-1)?.id ?? query.after ?? null }
  }

  async access (shellId: string): Promise<AccessDocument> {
    const response = await this.#http.request('aasRepository', `/shells/${encodeIdentifier(shellId)}/$access`)
    const document = await response.json() as JsonObject
    const principal = await this.#http.json<JsonObject>('aasRepository', '/security/rebac/principal').catch(() => ({} as JsonObject))
    return {
      grants: toAccessGrants(document),
      revision: response.headers.get('etag'),
      issuer: typeof principal.issuer === 'string' ? principal.issuer : null,
    }
  }

  async setAccess (shellId: string, grants: AccessGrant[], revision: string): Promise<AccessDocument> {
    const response = await this.#http.request('aasRepository', `/shells/${encodeIdentifier(shellId)}/$access/grants`, {
      method: 'PUT',
      body: { grants },
      headers: { 'If-Match': revision },
    })
    await response.body?.cancel()
    return this.access(shellId)
  }

  async effectiveRights (shellId: string): Promise<EffectiveRights> {
    return toEffectiveRights(await this.#http.json<JsonObject>('aasRepository', `/shells/${encodeIdentifier(shellId)}/$access/effective`))
  }

  async invite (shellId: string, relation: string, expiresAt: string, maxUses: number): Promise<InvitationResult> {
    const result = await this.#http.json<JsonObject>('aasRepository', `/shells/${encodeIdentifier(shellId)}/$access/invitations`, {
      method: 'POST',
      body: { relation, expiresAt, maxUses },
    })
    if (typeof result.token !== 'string') {
      throw new StudioProblem('target_invalid_response', 'The target did not return an invitation token.')
    }
    return { token: result.token, expiresAt: typeof result.expiresAt === 'string' ? result.expiresAt : expiresAt }
  }

  async acceptInvitation (token: string): Promise<void> {
    const response = await this.#http.request('aasRepository', '/security/rebac/invitations/accept', { method: 'POST', body: { token } })
    await response.body?.cancel()
  }

  async #operation (submodelId: string, idShortPath: string): Promise<JsonObject> {
    const { value } = await this.#read(submodelId, idShortPath)
    if (value.modelType !== 'Operation') {
      throw new StudioProblem('unsupported_operation', 'Only Operation elements can be invoked.')
    }
    return value
  }

  /** Runs a conditional write based on the revision the user saw, retrying on unrelated submodel changes. */
  async #conditionalWrite (
    submodelId: string,
    idShortPath: string,
    revision: string,
    write: (current: { value: JsonObject, etag: string | undefined }, configuration: Configuration) => Promise<SdkResult<unknown>>,
  ): Promise<ElementSnapshot> {
    const token = parseRevision(revision)
    for (let attempt = 1; ; attempt++) {
      const current = await this.#read(submodelId, idShortPath)
      if (contentHash(current.value) !== token.hash) {
        throw new StudioProblem('revision_conflict')
      }
      const result = await this.#send('submodelRepository', configuration => write(current, configuration))
      if (result.success) {
        return this.element(submodelId, idShortPath)
      }
      if (!result.preconditionFailed) {
        throw await this.#http.problem(result.statusCode, result.recorder)
      }
      if (attempt === writeAttempts) {
        throw new StudioProblem('revision_conflict', 'The submodel kept changing while saving. Try again.')
      }
    }
  }

  async #read (submodelId: string, idShortPath: string): Promise<{ value: JsonObject, etag: string | undefined }> {
    const result = await this.#send('submodelRepository', configuration =>
      this.#submodelClient.getSubmodelElementByPath({ configuration, submodelIdentifier: submodelId, idShortPath }))
    if (!result.success) {
      throw await this.#http.problem(result.statusCode, result.recorder)
    }
    return { value: toJson(result.data), etag: result.etag }
  }

  async #call<T> (type: EndpointType, operation: (configuration: Configuration) => Promise<SdkResult<T>>): Promise<T> {
    const result = await this.#send(type, operation)
    if (result.success) {
      return result.data
    }
    throw await this.#http.problem(result.statusCode, result.recorder)
  }

  async #send<T> (type: EndpointType, operation: (configuration: Configuration) => Promise<SdkResult<T>>): Promise<SdkResult<T> & { recorder: FailureRecorder }> {
    const recorder: FailureRecorder = {}
    return { ...await operation(this.#http.configuration(type, recorder)), recorder }
  }
}
