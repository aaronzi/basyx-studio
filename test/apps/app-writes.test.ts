import type { WorkspaceWorkerClient } from '~~/server/lib/workspaces/client'
import type { WorkspaceInfo } from '~~/server/lib/workspaces/protocol'
import { describe, expect, it } from 'vitest'
import { executeAasMethod } from '~~/server/lib/apps/calls'
import { WorkspaceManager } from '~~/server/lib/workspaces/manager'
import { WorkspaceWorker } from '~~/server/lib/workspaces/worker'
import { workspaceIdScheme } from '#shared/aas/identifiers'
import { appWritesContract } from '../support/app-writes'

// The structural app methods on a desktop workspace (MVP-7 A1, A2): the same
// worker calls as the editor's, so every write is an undo-log entry (ADR 0030).

const worker = new WorkspaceWorker()
const manager = new WorkspaceManager({ request: (request: Parameters<WorkspaceWorker['handle']>[0]) => worker.handle(request), close: () => {} } as unknown as WorkspaceWorkerClient)
const { workspaceId } = await worker.handle({ op: 'create' }) as WorkspaceInfo
const noSync = async () => ({ registry: false, submodelRegistry: false, discovery: false })
const context = { target: manager.target(workspaceId), idScheme: workspaceIdScheme, syncPlan: noSync }

describe('app structural writes on a workspace', () => {
  appWritesContract(() => ({ context, idPattern: /^urn:uuid:[\da-f-]{36}$/, created: { shells: [], submodels: [] } }))

  it('puts every write into the undo log', async () => {
    const { shell } = await executeAasMethod(context, 'studio.aas.createShell', { shell: { idShort: 'Undone' }, submodels: [] })
    const info = async () => (await worker.handle({ op: 'list' }) as WorkspaceInfo[]).find(item => item.workspaceId === workspaceId)!
    expect(await info()).toMatchObject({ canUndo: true, unsavedChanges: true })
    await context.target.undo()
    await expect(context.target.shell(String(shell.id))).rejects.toMatchObject({ code: 'target_resource_not_found' })
    expect(await info()).toMatchObject({ canRedo: true })
  })
})
