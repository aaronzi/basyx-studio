import type { DesktopState } from '#shared/contract'
import { requireBroker } from '~~/server/utils/desktop'
import { defineStudioHandler } from '~~/server/utils/handler'

/** Electron main process only: asked before the window closes. */
export default defineStudioHandler(async (event): Promise<DesktopState> => {
  const workspaces = await requireBroker(event)
  const open = await workspaces.list()
  return { unsavedWorkspaces: open.filter(workspace => workspace.unsavedChanges).map(workspace => workspace.fileName) }
}, { originCheck: false })
