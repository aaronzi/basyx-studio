import type { StudioConfig } from '../config'
import type { Violation } from '../problem'
import type { TrustedPublisher } from './trust'
import type { AppManifest } from '@basyx/studio-sdk/protocol'
import { isLoopbackOrigin, sandboxOrigins } from '@basyx/studio-app-kit/manifest'
import { sandboxOriginKinds } from '@basyx/studio-sdk/protocol'
import { StudioProblem } from '../problem'
import { allowedOrigins } from '../urls'
import { coversStudioOrigin } from './origins'
import { remoteCodeAllowed } from './trust'

export interface SandboxCheck {
  /** The trust store publisher whose key signed the package, if any. */
  publisher: TrustedPublisher | null
  /** An unsigned upload in developer mode (STUDIO_APPS_ALLOW_UNSIGNED). */
  developerMode: boolean
}

/**
 * The checks of a manifest's `sandbox` that depend on the deployment
 * (ADR 0045); the format is checked with the manifest. Declared origins may
 * not cover Studio's own origins or an apps origin, loopback origins are for
 * developer mode and desktop, and connect origins with WebAssembly or
 * workers need the publisher's `remoteCode` grant.
 */
export function checkSandbox (config: Pick<StudioConfig, 'deploymentMode' | 'publicUrl' | 'apps'>, manifest: AppManifest, check: SandboxCheck): void {
  const desktop = config.deploymentMode === 'desktop'
  const studioOrigins = allowedOrigins(config.publicUrl, desktop)
  const findings: Violation[] = []
  const origins = sandboxOrigins(manifest)
  for (const kind of sandboxOriginKinds) {
    for (const [index, origin] of origins[kind].entries()) {
      const path = `studio-app.json#sandbox.${kind}[${index}]`
      if (coversStudioOrigin(origin, studioOrigins, config.apps.baseUrl)) {
        findings.push({ path, message: 'covers an origin of this Studio or of its apps, which apps may not reach' })
      } else if (isLoopbackOrigin(origin) && !desktop && !check.developerMode) {
        findings.push({ path, message: 'is a loopback origin, which hosted Studio accepts only in developer mode' })
      }
    }
  }
  if (findings.length > 0) {
    throw new StudioProblem('app_package_rejected', findings.length === 1 ? 'The package has 1 finding.' : `The package has ${findings.length} findings.`, { violations: findings })
  }
  if (!remoteCodeAllowed(manifest, false, check.publisher)) {
    throw new StudioProblem('app_sandbox_not_granted', `${manifest.id} fetches from connect origins and runs WebAssembly or workers, so it could run code that is not in its package. Only publishers the trust store grants remoteCode may publish such apps (ADR 0045).`, {
      violations: [{ path: 'studio-app.json#sandbox', message: 'combines connectOrigins with webAssembly or workers' }],
    })
  }
}
