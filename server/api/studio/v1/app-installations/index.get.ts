import type { AppInstallationList } from '#shared/contract'
import { listInstallations, toAppInstallation } from '~~/server/lib/apps/store'
import { requireActor } from '~~/server/utils/auth'
import { defineStudioHandler } from '~~/server/utils/handler'
import { useStudio } from '~~/server/utils/studio'

export default defineStudioHandler(async (event): Promise<AppInstallationList> => {
  await requireActor(event)
  const studio = await useStudio()
  const { trustStore } = studio.config.apps
  return {
    items: (await listInstallations(studio)).map(record => toAppInstallation(record, trustStore)),
    enabled: studio.config.apps.baseUrl !== null,
    allowUnsigned: studio.config.apps.allowUnsigned,
    trustedPublishers: trustStore.publishers.map(publisher => publisher.name),
  }
})
