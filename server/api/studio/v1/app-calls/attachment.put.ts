import type { ElementSnapshot } from '@basyx/studio-sdk/protocol'
import { getRequestHeader } from 'nuxt/server'
import { getInstallation } from '~~/server/lib/apps/store'
import { performAppCall } from '~~/server/utils/apps'
import { requireActor, requireCsrf } from '~~/server/utils/auth'
import { readFileBody } from '~~/server/utils/files'
import { defineStudioHandler, queryValidated } from '~~/server/utils/handler'
import { useStudio } from '~~/server/utils/studio'
import { appAttachmentQuerySchema, putAttachmentMaxBytes } from '#shared/contract'

/**
 * `studio.aas.putAttachment` from the host bridge (MVP-7 A2): Studio's page
 * sends the bytes the frame handed it, as the signed-in user. The call is
 * authorized and audited like every other capability call; the body is the
 * file, up to 8 MiB and the deployment's upload limit.
 */
export default defineStudioHandler(async (event): Promise<{ result: ElementSnapshot }> => {
  const actor = await requireActor(event)
  await requireCsrf(event)
  const studio = await useStudio()
  const query = queryValidated(event, appAttachmentQuerySchema)
  const file = await readFileBody(event, Math.min(putAttachmentMaxBytes, studio.config.uploadMaxBytes))
  const result = await performAppCall(event, {
    caller: 'host',
    actor,
    installation: await getInstallation(studio, query.installationId),
    digest: query.digest,
    targetId: query.targetId,
    shellId: query.shellId ?? null,
    mode: query.mode,
    method: 'studio.aas.putAttachment',
    params: {
      submodelId: query.submodelId,
      idShortPath: query.idShortPath,
      fileName: query.fileName,
      contentType: getRequestHeader(event, 'content-type') ?? 'application/octet-stream',
      data: file.bytes,
      revision: query.revision,
    },
  })
  return { result: result as ElementSnapshot }
})
