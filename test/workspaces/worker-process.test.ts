import { copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { bundleWorkspaceWorker } from '~~/modules/workspace-worker'
import { WorkspaceWorkerClient } from '~~/server/lib/workspaces/client'
import { WorkspaceManager } from '~~/server/lib/workspaces/manager'
import { readPackage } from '~~/server/lib/workspaces/package'

const root = fileURLToPath(new URL('../..', import.meta.url))
const fixture = join(root, 'test-setup/fixtures/open/IESEDriveMotorDM3000.aasx')

// The real worker process, bundled the same way as for Studio builds.
describe('Workspace Worker process', () => {
  let directory: string
  let entry: string
  const managers: WorkspaceManager[] = []

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'studio-workspace-'))
    entry = join(directory, 'workspace-worker.mjs')
    await bundleWorkspaceWorker(root, entry)
  }, 60_000)

  afterAll(async () => {
    for (const manager of managers) {
      manager.dispose()
    }
    await rm(directory, { recursive: true, force: true })
  })

  function manager (options: { timeoutMs?: number, openTimeoutMs?: number } = {}) {
    const created = new WorkspaceManager(new WorkspaceWorkerClient({ entry, ...options }))
    managers.push(created)
    return created
  }

  async function copyOfFixture (name: string) {
    const path = join(directory, name)
    await copyFile(fixture, path)
    return path
  }

  async function firstProperty (workspaces: WorkspaceManager, workspaceId: string) {
    const target = workspaces.target(workspaceId)
    const shell = (await target.listShells(10, undefined)).items[0]!
    for (const submodelId of await target.submodelIds(shell.id)) {
      const submodel = await target.submodel(submodelId)
      const property = (submodel.submodelElements as Array<Record<string, unknown>> | undefined)
        ?.find(element => element.modelType === 'Property' && element.valueType === 'xs:string')
      if (property) {
        return { target, submodelId, path: String(property.idShort) }
      }
    }
    throw new Error('The fixture has no string property at the top level.')
  }

  it('opens, edits, detects conflicts, saves atomically and reopens a package', async () => {
    const workspaces = manager()
    const path = await copyOfFixture('edit.aasx')
    const info = await workspaces.open((await workspaces.grant(path, 'open')).handle)
    expect(info).toMatchObject({ fileName: 'edit.aasx', unsavedChanges: false })

    const { target, submodelId, path: idShortPath } = await firstProperty(workspaces, info.workspaceId)
    const before = await target.element(submodelId, idShortPath)
    expect(before.concurrency).toBe('strong')

    const after = await target.setElementValue(submodelId, idShortPath, 'edited in a workspace', before.revision)
    expect(after.value.value).toBe('edited in a workspace')
    await expect(target.setElementValue(submodelId, idShortPath, 'stale', before.revision))
      .rejects
      .toMatchObject({ code: 'revision_conflict' })
    expect((await workspaces.info(info.workspaceId)).unsavedChanges).toBe(true)

    // Closing with unsaved changes needs force.
    await expect(workspaces.close(info.workspaceId, false)).rejects.toMatchObject({ code: 'workspace_unsaved_changes' })

    const original = await readFile(path)
    expect((await workspaces.save(info.workspaceId)).unsavedChanges).toBe(false)
    expect((await readFile(path)).equals(original)).toBe(false)

    const reopened = await readPackage(new Uint8Array(await readFile(path)))
    const submodel = (reopened.environment.submodels as Array<Record<string, unknown>>).find(item => item.id === submodelId)!
    const property = (submodel.submodelElements as Array<Record<string, unknown>>).find(element => element.idShort === idShortPath)!
    expect(property.value).toBe('edited in a workspace')
    await workspaces.close(info.workspaceId, false)
  })

  it('saves as a new file, which then becomes the workspace file', async () => {
    const workspaces = manager()
    const path = await copyOfFixture('original.aasx')
    const copy = join(directory, 'copy.aasx')
    const info = await workspaces.open((await workspaces.grant(path, 'open')).handle)
    const { target, submodelId, path: idShortPath } = await firstProperty(workspaces, info.workspaceId)
    const before = await target.element(submodelId, idShortPath)
    await target.setElementValue(submodelId, idShortPath, 'only in the copy', before.revision)

    const original = await readFile(path)
    const saved = await workspaces.saveAs(info.workspaceId, (await workspaces.grant(copy, 'save')).handle)
    expect(saved).toMatchObject({ fileName: 'copy.aasx', unsavedChanges: false })
    expect((await readFile(path)).equals(original)).toBe(true)
    expect((await readPackage(new Uint8Array(await readFile(copy)))).environment).toBeTruthy()
  })

  it('rejects grants for other files and expired or reused handles', async () => {
    const workspaces = manager()
    await expect(workspaces.grant(join(directory, 'missing.aasx'), 'open')).rejects.toMatchObject({ code: 'not_found' })
    await expect(workspaces.grant('relative.aasx', 'open')).rejects.toMatchObject({ code: 'invalid_request' })
    await expect(workspaces.grant(join(directory, 'note.txt'), 'save')).rejects.toMatchObject({ code: 'invalid_request' })

    const { handle } = await workspaces.grant(await copyOfFixture('once.aasx'), 'open')
    await expect(workspaces.saveAs('ws-aaaaaaaaaaaa', handle)).rejects.toMatchObject({ code: 'invalid_request' })
    await expect(workspaces.open(handle)).rejects.toMatchObject({ code: 'invalid_request' })
  })

  it('rejects a malformed package and keeps serving', async () => {
    const workspaces = manager()
    const path = join(directory, 'broken.aasx')
    await writeFile(path, 'not a zip')
    await expect(workspaces.open((await workspaces.grant(path, 'open')).handle)).rejects.toMatchObject({ code: 'package_rejected' })
    const ok = await workspaces.open((await workspaces.grant(await copyOfFixture('after-broken.aasx'), 'open')).handle)
    expect(ok.fileName).toBe('after-broken.aasx')
  })

  it('stops a worker that exceeds its time limit and starts a fresh one', async () => {
    const workspaces = manager({ openTimeoutMs: 1 })
    const exited = new Promise<void>(resolve => {
      workspaces.client.onExit = resolve
    })
    await expect(workspaces.open((await workspaces.grant(await copyOfFixture('slow.aasx'), 'open')).handle))
      .rejects
      .toMatchObject({ code: 'package_rejected', message: expect.stringMatching(/took too long/) })
    await exited
    expect(await workspaces.list()).toEqual([])
  })
})
