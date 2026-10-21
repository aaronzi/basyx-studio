import type { AppInstallation } from '#shared/contract'
import { readBody } from 'nuxt/server'
import { updateInstallationSettings } from '~~/server/lib/apps/settings'
import { describeInstallation } from '~~/server/lib/apps/store'
import { requireAdmin, requireCsrf } from '~~/server/utils/auth'
import { defineStudioHandler, requestIdOf, routeParam } from '~~/server/utils/handler'
import { useStudio } from '~~/server/utils/studio'

/** Replaces the installation's settings values (ADR 0048); values the settings do not accept are refused. */
export default defineStudioHandler(async (event): Promise<AppInstallation> => {
  const actor = await requireAdmin(event)
  await requireCsrf(event)
  const studio = await useStudio()
  const record = await updateInstallationSettings(studio, actor, routeParam(event, 'installationId'), await readBody(event), requestIdOf(event))
  return describeInstallation(studio, record)
})
