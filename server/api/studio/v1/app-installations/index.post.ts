import type { AppInstallation, AppPackageInspection } from '#shared/contract'
import { getQuery, getRequestHeader, setResponseStatus } from 'nuxt/server'
import { appArchiveLimits } from '~~/server/lib/apps/package'
import { maxSignatureLength } from '~~/server/lib/apps/signature'
import { inspectAppPackage, installApp, toAppInstallation } from '~~/server/lib/apps/store'
import { StudioProblem } from '~~/server/lib/problem'
import { requireAdmin, requireCsrf } from '~~/server/utils/auth'
import { defineStudioHandler, requestIdOf } from '~~/server/utils/handler'
import { useStudio } from '~~/server/utils/studio'

/**
 * Installs an app package, or updates the installed app with the same ID in
 * place (ADR 0044). The body is the ZIP file; `Studio-App-Signature` carries
 * the content of its `.sig` file. With `?inspect=true`, the package is only
 * checked, and the answer says what installing it would do.
 */
export default defineStudioHandler(async (event): Promise<AppInstallation | AppPackageInspection> => {
  const actor = await requireAdmin(event)
  await requireCsrf(event)
  const declared = Number(getRequestHeader(event, 'content-length') ?? 0)
  if (declared > appArchiveLimits.maxArchiveBytes) {
    throw new StudioProblem('app_package_rejected', 'The package is larger than 20 MiB.', { violations: [{ path: '(archive)', message: 'is larger than 20 MiB' }] })
  }
  const signature = getRequestHeader(event, 'studio-app-signature')?.trim() || null
  if (signature && signature.length > maxSignatureLength) {
    throw new StudioProblem('app_signature_invalid', 'The signature is longer than 16 KiB.')
  }
  const bytes = new Uint8Array(await event.req.arrayBuffer())
  if (bytes.length === 0) {
    throw new StudioProblem('invalid_request', 'The request body must be the app package (ZIP).')
  }
  const studio = await useStudio()
  if (getQuery(event).inspect === 'true') {
    return inspectAppPackage(studio, bytes, signature)
  }
  const { record, previous } = await installApp(studio, actor, bytes, signature, requestIdOf(event))
  if (previous) {
    // The backend starts with the new files on its next call.
    await studio.backends?.stop(record.id)
  }
  setResponseStatus(event, previous ? 200 : 201)
  return toAppInstallation(record, studio.config.apps.trustStore)
})
