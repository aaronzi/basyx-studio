import type { AppInstallation } from '#shared/contract'
import { getInstallation, toAppInstallation } from '~~/server/lib/apps/store'
import { requireActor } from '~~/server/utils/auth'
import { defineStudioHandler, routeParam } from '~~/server/utils/handler'
import { useStudio } from '~~/server/utils/studio'

export default defineStudioHandler(async (event): Promise<AppInstallation> => {
  await requireActor(event)
  const studio = await useStudio()
  return toAppInstallation(await getInstallation(studio, routeParam(event, 'installationId')), studio.config.apps.trustStore)
})
