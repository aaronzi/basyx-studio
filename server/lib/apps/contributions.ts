import type { AppContributions, SubmodelViewContributionInfo } from '#shared/contract'
import type { AppInstallationRecord } from './store'
import { StudioProblem } from '../problem'
import { appFileUrl, appFrameOrigin } from './origins'

/**
 * The contributions of the installed apps. Modules are returned always; the
 * UI shows them for their context. Submodel views are returned only for the
 * given submodel semantic IDs, matched exactly (as in the BaSyx AAS Web UI),
 * with the matching ID as the reason.
 */
export function contributionsFor (installations: AppInstallationRecord[], baseUrl: string, semanticIds: string[]): AppContributions {
  const result: AppContributions = { submodelViews: [], modules: [] }
  for (const installation of installations) {
    const { manifest } = installation
    const base = {
      installationId: installation.id,
      appId: installation.appId,
      appTitle: manifest.title,
      permissions: manifest.permissions,
      digest: installation.digest,
      unsigned: installation.trust === 'unsigned',
      bundled: installation.bundled,
      frameOrigin: appFrameOrigin(baseUrl, installation.id),
    }
    for (const semanticId of semanticIds) {
      for (const view of manifest.contributes.submodelViews ?? []) {
        if (view.semanticIds.includes(semanticId)) {
          result.submodelViews.push({
            kind: 'submodelView',
            ...base,
            id: view.id,
            title: view.title,
            entryUrl: appFileUrl(baseUrl, installation.id, view.entry),
            reason: { semanticId },
            columns: view.columns ?? {},
          })
        }
      }
    }
    for (const module of manifest.contributes.modules ?? []) {
      result.modules.push({
        kind: 'module',
        ...base,
        id: module.id,
        title: module.title,
        icon: module.icon ?? null,
        route: module.route,
        context: module.context,
        layout: module.layout ?? 'standard',
        entryUrl: appFileUrl(baseUrl, installation.id, module.entry),
      })
    }
  }
  return result
}

/**
 * The view `studio.ui.openView` shows for a submodel's semantic ID
 * (ADR 0051): the one the shell's Overview shows first, so the apps shipped
 * with Studio before installed ones, or the first view of the app `appId`,
 * or its view `viewId`. Without one, the app is told so and can open the
 * shell's page instead.
 */
export function viewToOpen (installations: AppInstallationRecord[], baseUrl: string, semanticId: string, choice: { appId?: string, viewId?: string } = {}): SubmodelViewContributionInfo {
  const view = contributionsFor(installations, baseUrl, [semanticId]).submodelViews.toSorted((a, b) => Number(b.bundled) - Number(a.bundled)).find(view => (choice.appId === undefined || view.appId === choice.appId) && (choice.viewId === undefined || view.id === choice.viewId))
  if (!view) {
    throw new StudioProblem('unsupported_operation', choice.appId === undefined
      ? 'No installed app has a view for this submodel.'
      : `${choice.appId} is not installed, or has no such view for this submodel.`)
  }
  return view
}
