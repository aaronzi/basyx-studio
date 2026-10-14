import type { TargetCapabilities } from '#shared/contract'
import type { InfrastructureRecord } from '../infrastructures'
import { serviceUrl } from '#shared/contract'
import { environmentUrl } from '../infrastructures'
import { announcedFeatures } from './profiles'

/**
 * Capabilities of a live infrastructure: what its configured endpoints offer
 * and what its services announce in `/description` (MVP-4 plan, I6).
 */
export function liveCapabilities (record: Pick<InfrastructureRecord, 'endpoints' | 'template' | 'serviceProfiles' | 'security' | 'listSource'>): TargetCapabilities {
  const environment = environmentUrl(record) !== undefined
  const announced = announcedFeatures(record)
  return {
    write: true,
    persistence: 'immediate',
    deleteShells: true,
    files: true,
    operations: true,
    conceptDescriptions: serviceUrl(record, 'conceptDescriptionRepository') !== undefined,
    search: environment ? 'elements' : 'shells',
    discovery: serviceUrl(record, 'aasDiscovery') !== undefined,
    export: environment,
    upload: environment,
    history: announced.history,
    changeFeed: announced.changeFeed,
    // Grants and rights mean something only when the target sees the user (D15).
    sharing: announced.rebac && record.security.mode === 'delegated_user',
    listSource: record.listSource === 'registry' && serviceUrl(record, 'aasRegistry') !== undefined ? 'registry' : 'repository',
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
  history: false,
  changeFeed: false,
  sharing: false,
  listSource: 'repository',
}
