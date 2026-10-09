import type { ElementValueInput, EndpointType, Page, ShellSummary, TargetCapabilities } from '#shared/contract'
import type { JsonObject } from '../aas/outline'
import type { InfrastructureRecord } from '../infrastructures'
import type { FailureRecorder, OutboundPolicy } from '../network/guarded-fetch'
import type { AasTarget, ElementSnapshot } from './aas-target'
import type { TargetAccess } from './credentials'
import type { types } from '@aas-core-works/aas-core3.1-typescript'
import { jsonization } from '@aas-core-works/aas-core3.1-typescript'
import { AasRepositoryClient, Configuration, SubmodelRepositoryClient } from 'basyx-typescript-sdk'
import { submodelIdOf, toShellSummary } from '../aas/shells'
import { withValue } from '../aas/values'
import { endpointUrl } from '../infrastructures'
import { createGuardedFetch } from '../network/guarded-fetch'
import { StudioProblem } from '../problem'
import { contentHash, parseRevision, revisionOf } from './revision'

type SdkResult<T>
  = | { success: true, data: T, statusCode?: number, etag?: string }
    | { success: false, error: unknown, statusCode?: number, etag?: string, preconditionFailed?: boolean }

/** Attempts per write when the submodel revision changes between read and write. */
const writeAttempts = 3

export interface LiveTargetOptions {
  record: InfrastructureRecord
  access: TargetAccess
  policy: OutboundPolicy
  requestId: string
  /** Called when the target rejects the credentials (HTTP 401). */
  onUnauthorized: () => Promise<void>
}

/**
 * Converts SDK results to plain JSON at the adapter boundary. The SDK bundles
 * its own copy of aas-core, so its instances fail `instanceof` checks against
 * Studio's copy; serialization works because it dispatches through methods.
 */
function toJson (value: types.Class): JsonObject {
  return jsonization.toJsonable(value) as JsonObject
}

/** Live AAS target backed by `basyx-typescript-sdk`, scoped to one request. */
export class LiveAasTarget implements AasTarget {
  readonly capabilities: TargetCapabilities = { write: true, persistence: 'immediate' }
  readonly #aasClient = new AasRepositoryClient()
  readonly #submodelClient = new SubmodelRepositoryClient()

  constructor (private readonly options: LiveTargetOptions) {}

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
    const token = parseRevision(revision)
    for (let attempt = 1; ; attempt++) {
      const current = await this.#read(submodelId, idShortPath)
      if (contentHash(current.value) !== token.hash) {
        throw new StudioProblem('revision_conflict')
      }
      const { instance } = withValue(current.value, value)
      const result = await this.#send('submodelRepository', configuration =>
        this.#submodelClient.patchSubmodelElementByPath({
          configuration,
          submodelIdentifier: submodelId,
          idShortPath,
          submodelElement: instance,
          ifMatch: current.etag,
        }))
      if (result.success) {
        return this.element(submodelId, idShortPath)
      }
      if (!result.preconditionFailed) {
        throw await this.#problem(result.statusCode, result.recorder)
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
      throw await this.#problem(result.statusCode, result.recorder)
    }
    return { value: toJson(result.data), etag: result.etag }
  }

  #configuration (type: EndpointType, recorder: FailureRecorder): Configuration {
    const basePath = endpointUrl(this.options.record, type)
    if (!basePath) {
      throw new StudioProblem('target_request_rejected', `The target has no ${type} endpoint.`)
    }
    const headers: Record<string, string> = { 'X-Request-ID': this.options.requestId }
    if (this.options.access.accessToken) {
      headers.Authorization = `Bearer ${this.options.access.accessToken}`
    }
    return new Configuration({
      basePath,
      fetchApi: createGuardedFetch(this.options.policy, { recorder, headers }),
    })
  }

  async #call<T> (type: EndpointType, operation: (configuration: Configuration) => Promise<SdkResult<T>>): Promise<T> {
    const result = await this.#send(type, operation)
    if (result.success) {
      return result.data
    }
    throw await this.#problem(result.statusCode, result.recorder)
  }

  async #send<T> (type: EndpointType, operation: (configuration: Configuration) => Promise<SdkResult<T>>): Promise<SdkResult<T> & { recorder: FailureRecorder }> {
    const recorder: FailureRecorder = {}
    return { ...await operation(this.#configuration(type, recorder)), recorder }
  }

  async #problem (status: number | undefined, recorder: FailureRecorder): Promise<StudioProblem> {
    const failure = recorder.failure
    if (failure) {
      switch (failure.kind) {
        case 'blocked': {
          return new StudioProblem('target_blocked', failure.message)
        }
        case 'too_large': {
          return new StudioProblem('target_invalid_response', failure.message)
        }
        case 'timeout': {
          return new StudioProblem('target_unreachable', `The target did not answer in time (${failure.message}).`)
        }
        default: {
          return new StudioProblem('target_unreachable', failure.message)
        }
      }
    }
    const mode = this.options.record.security.mode
    switch (status) {
      case 401: {
        await this.options.onUnauthorized()
        if (mode === 'deployment_client_credentials') {
          return new StudioProblem('target_credentials_rejected')
        }
        return new StudioProblem('target_auth_required', mode === 'unsecured'
          ? 'The target requires authentication, but it is configured as unsecured.'
          : 'The target rejected the authorization. Authorize this target again.')
      }
      case 403: {
        return new StudioProblem('target_forbidden')
      }
      case 428: {
        return new StudioProblem('target_request_rejected', 'The target requires a revision (If-Match) for this write.')
      }
      case 404: {
        return new StudioProblem('target_resource_not_found')
      }
      case 400: {
        return new StudioProblem('target_request_rejected')
      }
      case undefined:
      case 0: {
        return new StudioProblem('target_unreachable')
      }
      default: {
        if (status >= 500) {
          return new StudioProblem('target_error', `The target answered with HTTP ${status}.`)
        }
        // The SDK reports undeserializable payloads with its own code.
        return new StudioProblem('target_invalid_response', `Unexpected answer (HTTP ${status}).`)
      }
    }
  }
}
