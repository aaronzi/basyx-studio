import type { AppConnectionSummary } from '#shared/contract'
import type { StudioDeps } from '../deps'
import type { AppInstallationRecord } from './store'
import type { ConnectionApi } from '@basyx/studio-app-kit/manifest'
import type { AppManifest } from '@basyx/studio-sdk/protocol'
import { checkConnectionApis } from '@basyx/studio-app-kit/manifest'
import { readAppFiles } from './store'

// The connections an app declares (ADR 0047): their OpenAPI documents are
// files of the package, checked at upload. Studio indexes and compiles them
// once per package digest, for calls and for the dialogs that list the
// operations.

/** The connections of a manifest with their operations as method and path, for consent and binding. */
export function connectionSummaries (manifest: AppManifest, apis: ReadonlyMap<string, ConnectionApi>): AppConnectionSummary[] {
  return (manifest.connections ?? []).map(connection => ({
    id: connection.id,
    title: connection.title,
    description: connection.description ?? null,
    operations: connection.operations.flatMap(operationId => {
      const operation = apis.get(connection.id)?.index.operations.get(operationId)
      return operation ? [{ operationId, method: operation.method, path: operation.path, summary: operation.summary }] : []
    }),
  }))
}

const maxCached = 64
const cache = new Map<string, Promise<Map<string, ConnectionApi>>>()

/**
 * The indexed documents of an installation's connections, by connection ID.
 * A document that no longer passes the checks (e.g. after a Studio upgrade)
 * is left out, so calls to it are refused as undeclared.
 */
export function installationConnectionApis (deps: Pick<StudioDeps, 'db'>, record: Pick<AppInstallationRecord, 'id' | 'digest' | 'manifest'>): Promise<Map<string, ConnectionApi>> {
  const connections = record.manifest.connections ?? []
  if (connections.length === 0) {
    return Promise.resolve(new Map())
  }
  const cached = cache.get(record.digest)
  if (cached) {
    return cached
  }
  const loaded = (async () => {
    const files = await readAppFiles(deps, record.id, [...new Set(connections.map(connection => connection.api))])
    const decoder = new TextDecoder('utf-8', { fatal: false })
    return checkConnectionApis(record.manifest, path => files.has(path) ? decoder.decode(files.get(path)) : undefined).apis
  })()
  cache.set(record.digest, loaded)
  loaded.catch(() => cache.delete(record.digest))
  if (cache.size > maxCached) {
    cache.delete(cache.keys().next().value!)
  }
  return loaded
}

/** The summaries of an installation's connections, for the *Apps* page and the binding dialog. */
export async function installationConnections (deps: Pick<StudioDeps, 'db'>, record: Pick<AppInstallationRecord, 'id' | 'digest' | 'manifest'>): Promise<AppConnectionSummary[]> {
  return connectionSummaries(record.manifest, await installationConnectionApis(deps, record))
}
