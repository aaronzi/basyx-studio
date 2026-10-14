import type { TargetCapabilities } from '#shared/contract'
import type { InfrastructureRecord } from '../infrastructures'
import type { DetectedFeatures } from './aas-target'
import { endpointUrl, isEnvironment } from '../infrastructures'

export const noDetectedFeatures: DetectedFeatures = { history: false, changeFeed: false, sharing: false }

/**
 * Capabilities of a live infrastructure: what its configured endpoints
 * offer, plus the optional features detected on the server.
 */
export function liveCapabilities (record: Pick<InfrastructureRecord, 'endpoints'>, detected: DetectedFeatures | null): TargetCapabilities {
  const environment = isEnvironment(record)
  return {
    write: true,
    persistence: 'immediate',
    deleteShells: true,
    files: true,
    operations: true,
    conceptDescriptions: endpointUrl(record, 'conceptDescriptionRepository') !== undefined,
    search: environment ? 'elements' : 'shells',
    discovery: endpointUrl(record, 'discovery') !== undefined,
    export: environment,
    upload: environment,
    ...(detected ?? noDetectedFeatures),
  }
}

/** Desktop AASX workspaces: local editing without server-only features (D13). */
export const workspaceCapabilities: TargetCapabilities = {
  write: true,
  persistence: 'explicit_save',
  deleteShells: true,
  files: true,
  operations: false,
  conceptDescriptions: true,
  search: 'elements',
  discovery: false,
  export: false,
  upload: false,
  ...noDetectedFeatures,
}
