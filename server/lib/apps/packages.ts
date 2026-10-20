import type { StudioDeps } from '../deps'
import type { AppPackage } from './package'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { appInstallations } from '../../database/schema'
import { recordAudit } from '../audit'
import { StudioProblem } from '../problem'
import { appArchiveLimits, readAppPackage } from './package'
import { bundledOnlyPermissions, listInstallations, lockAppId, managedInstaller, newInstallationId, removeInstallation, sourceOf, writeInstallation } from './store'
import { verifyPackageSignature } from './trust'

// Managed packages (ADR 0044, MVP-7 M2): app packages the deployment mounts
// and names in STUDIO_APP_PACKAGES, installed or updated at startup by
// digest. A `<package>.zip.sig` next to a package must verify; without one,
// the operator vouches for the package.

export interface ManagedPackage {
  path: string
  bytes: Uint8Array
  /** The content of `<path>.sig`, if there is one. */
  signature: string | null
}

/** Reads the configured packages: `.zip` files, and the `.zip` files directly in configured directories. */
export function readManagedPackages (paths: string[]): { packages: ManagedPackage[], problems: string[] } {
  const packages: ManagedPackage[] = []
  const problems: string[] = []
  const files: string[] = []
  for (const path of paths) {
    try {
      if (statSync(path).isDirectory()) {
        files.push(...readdirSync(path).filter(name => name.toLowerCase().endsWith('.zip')).toSorted().map(name => join(path, name)))
      } else {
        files.push(path)
      }
    } catch {
      problems.push(`${path} cannot be read`)
    }
  }
  for (const file of files) {
    try {
      if (statSync(file).size > appArchiveLimits.maxArchiveBytes) {
        problems.push(`${file} is larger than 20 MiB`)
        continue
      }
      const bytes = new Uint8Array(readFileSync(file))
      const signaturePath = `${file}.sig`
      let signature: string | null = null
      if (existsSync(signaturePath)) {
        try {
          signature = readFileSync(signaturePath, 'utf8')
        } catch {
          problems.push(`${signaturePath} cannot be read`)
          continue
        }
      }
      packages.push({ path: file, bytes, signature })
    } catch {
      problems.push(`${file} cannot be read`)
    }
  }
  return { packages, problems }
}

export type ManagedOutcome = 'installed' | 'updated' | 'unchanged'

/**
 * Installs or updates one managed package. Unlike uploads, it may go back to
 * a lower version and takes over an app ID that an administrator or Studio
 * installed; the installation ID stays.
 */
export async function installManagedApp (deps: StudioDeps, item: ManagedPackage, pkg: AppPackage = readAppPackage(item.bytes, deps.config.deploymentMode)): Promise<ManagedOutcome> {
  const reserved = pkg.manifest.permissions.filter(permission => (bundledOnlyPermissions as readonly string[]).includes(permission))
  if (reserved.length > 0) {
    throw new StudioProblem('app_package_rejected', `${reserved.join(', ')} is reserved for the apps shipped with Studio (ADR 0033).`)
  }
  const signer = item.signature === null ? null : verifyPackageSignature(deps.config.apps.trustStore, item.bytes, item.signature, pkg.manifest.id)
  const source = sourceOf(signer, 'managed', { bundled: false, managed: true, installedBy: managedInstaller })

  const result = await deps.db.transaction(async tx => {
    await lockAppId(tx, pkg.manifest.id)
    const [existing] = await tx.select().from(appInstallations).where(eq(appInstallations.appId, pkg.manifest.id))
    if (existing?.managed && existing.digest === pkg.digest && existing.trust === source.trust && existing.keyFingerprint === source.keyFingerprint) {
      return { existing, outcome: 'unchanged' as const }
    }
    const record = await writeInstallation(tx, existing?.id ?? newInstallationId(), Boolean(existing), pkg, source)
    return { existing, record, outcome: existing ? 'updated' as const : 'installed' as const }
  })
  if (result.outcome !== 'unchanged') {
    const { existing, record } = result
    await recordAudit(deps, {
      action: existing ? 'app.update' : 'app.install',
      outcome: 'success',
      actorSubject: managedInstaller,
      appInstallationId: record!.id,
      details: {
        appId: record!.appId,
        version: record!.version,
        digest: record!.digest,
        trust: record!.trust,
        publisher: record!.publisher,
        keyFingerprint: record!.keyFingerprint,
        permissions: record!.manifest.permissions,
        ...(existing ? { previousVersion: existing.version, previousDigest: existing.digest } : {}),
      },
    })
  }
  return result.outcome
}

export interface ManagedReconciliation {
  installed: string[]
  updated: string[]
  removed: string[]
  /** Packages that were not installed, with the reason; their previous installation stays. */
  failed: string[]
}

/**
 * Brings the managed installations in line with the configured packages:
 * installs and updates them, and uninstalls managed apps that are no longer
 * configured. When a package cannot be read or installed, nothing is
 * removed, because its app ID may be among them.
 */
export async function reconcileManagedPackages (deps: StudioDeps, paths: string[]): Promise<ManagedReconciliation> {
  const result: ManagedReconciliation = { installed: [], updated: [], removed: [], failed: [] }
  const { packages, problems } = readManagedPackages(paths)
  result.failed.push(...problems)
  const configured = new Set<string>()
  for (const item of packages) {
    try {
      const pkg = readAppPackage(item.bytes, deps.config.deploymentMode)
      const appId = pkg.manifest.id
      if (configured.has(appId)) {
        result.failed.push(`${item.path}: ${appId} is configured twice`)
        continue
      }
      configured.add(appId)
      const outcome = await installManagedApp(deps, item, pkg)
      if (outcome !== 'unchanged') {
        result[outcome].push(appId)
      }
    } catch (error) {
      result.failed.push(`${item.path}: ${error instanceof StudioProblem ? (error.detail ?? error.title) : (error instanceof Error ? error.message : String(error))}`)
    }
  }
  if (result.failed.length > 0) {
    return result
  }
  for (const record of await listInstallations(deps)) {
    if (record.managed && !configured.has(record.appId)) {
      await removeInstallation(deps, record, managedInstaller)
      result.removed.push(record.appId)
    }
  }
  return result
}
