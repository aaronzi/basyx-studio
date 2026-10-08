import type { FileGrant } from '#shared/contract'
import { requireBroker } from '~~/server/utils/desktop'
import { defineStudioHandler, readValidated } from '~~/server/utils/handler'
import { fileGrantInputSchema } from '#shared/contract'

/** Electron main process only: turns a path the user chose into a single-use handle. */
export default defineStudioHandler(async (event): Promise<FileGrant> => {
  const workspaces = await requireBroker(event)
  const { path, purpose } = await readValidated(event, fileGrantInputSchema)
  return workspaces.grant(path, purpose)
}, { originCheck: false })
