import type { AppConnectionSummary, DeploymentMode } from '#shared/contract'
import type { Violation } from '../problem'
import type { AppManifest } from '@basyx/studio-sdk/protocol'
import { createHash } from 'node:crypto'
import { appArchiveLimits, checkConnectionApis, contentTypeOf, isArchiveLitter, maxManifestBytes } from '@basyx/studio-app-kit/manifest'
import { unzipSync } from 'fflate'
import { StudioProblem } from '../problem'
import { inspectArchive } from '../workspaces/archive'
import { connectionSummaries } from './connections'
import { checkCompatibility, checkManifestConsistency, manifestFileName, parseManifest } from './manifest'

// The package limits, file types and litter rules are shared with the app
// kit's `studio-app` command (ADR 0043).
export { appArchiveLimits, appContentTypes, contentTypeOf } from '@basyx/studio-app-kit/manifest'

export function sha256Hex (bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

export interface AppPackageFile {
  path: string
  digest: string
  contentType: string
  content: Uint8Array
}

export interface AppPackage {
  manifest: AppManifest
  /** `sha256:<hex>` of the archive as uploaded. */
  digest: string
  files: AppPackageFile[]
  /** The declared connections with their operations (ADR 0047). */
  connections: AppConnectionSummary[]
}

function summary (findings: Violation[]): string {
  return findings.length === 1 ? 'The package has 1 finding.' : `The package has ${findings.length} findings.`
}

/** The findings are in `violations`; the detail only counts them. */
function rejected (findings: Violation[]): StudioProblem {
  return new StudioProblem('app_package_rejected', summary(findings), { violations: findings })
}

/**
 * Validates an uploaded app package (ZIP) completely before anything is
 * stored: archive limits and entry names, allowed file types, the manifest
 * schema and its references, and compatibility with this Studio. With
 * `deploymentMode` `null`, the caller checks the app's runtimes itself.
 */
export function readAppPackage (bytes: Uint8Array, deploymentMode: DeploymentMode | null): AppPackage {
  try {
    inspectArchive(bytes, appArchiveLimits, 'app package (ZIP)')
  } catch (error) {
    if (error instanceof StudioProblem && error.code === 'package_rejected') {
      throw rejected([{ path: '(archive)', message: (error.detail ?? error.title).replace(/^The (?:file|package) /, '').replace(/\.$/, '') }])
    }
    throw error
  }

  const entries = unzipSync(bytes)
  let names = Object.keys(entries).filter(name => !name.endsWith('/') && !isArchiveLitter(name))

  // Accept archives of a folder: strip a single top-level directory that
  // holds the manifest.
  if (!names.includes(manifestFileName)) {
    const tops = new Set(names.map(name => name.split('/', 1)[0]))
    const [top] = tops
    if (tops.size === 1 && names.includes(`${top}/${manifestFileName}`)) {
      const prefix = `${top}/`
      for (const name of names) {
        entries[name.slice(prefix.length)] = entries[name]!
      }
      names = names.map(name => name.slice(prefix.length))
    }
  }

  const findings: Violation[] = []
  const files: AppPackageFile[] = []
  for (const path of names) {
    if (path === manifestFileName) {
      continue
    }
    const contentType = contentTypeOf(path)
    if (!contentType) {
      findings.push({ path, message: 'has a file type that apps may not contain' })
      continue
    }
    const content = entries[path]!
    files.push({ path, digest: sha256Hex(content), contentType, content })
  }

  const manifestBytes = entries[manifestFileName]
  if (!manifestBytes) {
    throw rejected([...findings, { path: manifestFileName, message: 'is missing at the package root' }])
  }
  if (manifestBytes.length > maxManifestBytes) {
    throw rejected([...findings, { path: manifestFileName, message: 'is larger than 64 KiB' }])
  }
  const parsed = parseManifest(new TextDecoder('utf-8', { fatal: false }).decode(manifestBytes))
  if (!parsed.manifest) {
    throw rejected([...findings, ...parsed.findings])
  }
  findings.push(...checkManifestConsistency(parsed.manifest, new Set(files.map(file => file.path))))
  const decoder = new TextDecoder('utf-8', { fatal: false })
  const apis = checkConnectionApis(parsed.manifest, path => {
    const file = files.find(candidate => candidate.path === path)
    return file ? decoder.decode(file.content) : undefined
  })
  findings.push(...apis.findings)
  if (findings.length > 0) {
    throw rejected(findings)
  }

  const incompatible = checkCompatibility(parsed.manifest, deploymentMode)
  if (incompatible.length > 0) {
    throw new StudioProblem('app_incompatible', summary(incompatible), { violations: incompatible })
  }

  return { manifest: parsed.manifest, digest: `sha256:${sha256Hex(bytes)}`, files, connections: connectionSummaries(parsed.manifest, apis.apis) }
}
