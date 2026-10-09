import type { Target, TargetCapabilities } from '#shared/contract'
import type { JsonObject } from '../aas/outline'
import type { AasTarget, ElementSnapshot } from '../targets/aas-target'
import type { WorkspaceWorkerClient } from './client'
import type { WorkspaceCalls, WorkspaceInfo, WorkspaceMethod } from './protocol'
import { randomBytes } from 'node:crypto'
import { stat } from 'node:fs/promises'
import { basename, dirname, extname, isAbsolute } from 'node:path'
import { StudioProblem } from '../problem'

export type FileGrantPurpose = 'open' | 'save'

interface FileGrant {
  path: string
  purpose: FileGrantPurpose
  expiresAt: number
}

const grantTtlMs = 5 * 60 * 1000
const workspaceCapabilities: TargetCapabilities = { write: true, persistence: 'explicit_save' }

export function isWorkspaceId (id: string): boolean {
  return /^ws-[\w-]{12}$/.test(id)
}

export function toWorkspaceTarget (info: WorkspaceInfo): Target {
  return {
    id: info.workspaceId,
    kind: 'workspace',
    name: info.fileName,
    description: null,
    securityMode: null,
    authenticationState: 'not_required',
    capabilities: workspaceCapabilities,
    workspace: { fileName: info.fileName, unsavedChanges: info.unsavedChanges },
  }
}

/** A desktop AASX workspace as a Studio target; every operation runs in the Workspace Worker. */
class WorkspaceAasTarget implements AasTarget {
  readonly capabilities = workspaceCapabilities

  constructor (private readonly client: WorkspaceWorkerClient, private readonly workspaceId: string) {}

  listShells = (limit: number, cursor: string | undefined) => this.#call('listShells', limit, cursor)
  shell = (id: string): Promise<JsonObject> => this.#call('shell', id)
  submodelIds = (shellId: string) => this.#call('submodelIds', shellId)
  submodelMetadata = (id: string): Promise<JsonObject> => this.#call('submodelMetadata', id)
  submodel = (id: string): Promise<JsonObject> => this.#call('submodel', id)
  element = (submodelId: string, idShortPath: string): Promise<ElementSnapshot> => this.#call('element', submodelId, idShortPath)
  setElementValue: AasTarget['setElementValue'] = (submodelId, idShortPath, value, revision) =>
    this.#call('setElementValue', submodelId, idShortPath, value, revision)

  #call<M extends WorkspaceMethod> (method: M, ...args: Parameters<WorkspaceCalls[M]>): Promise<ReturnType<WorkspaceCalls[M]>> {
    return this.client.request({ op: 'call', workspaceId: this.workspaceId, method, args }) as Promise<ReturnType<WorkspaceCalls[M]>>
  }
}

/**
 * Desktop AASX workspaces. Native paths only arrive as file grants from the
 * Electron main process (after a user picked them in a dialog); the renderer
 * only ever sees opaque, short-lived, single-use handles.
 */
export class WorkspaceManager {
  readonly #grants = new Map<string, FileGrant>()

  constructor (readonly client: WorkspaceWorkerClient) {}

  async grant (path: string, purpose: FileGrantPurpose): Promise<{ handle: string, fileName: string }> {
    if (!isAbsolute(path) || extname(path).toLowerCase() !== '.aasx') {
      throw new StudioProblem('invalid_request', 'Only absolute paths of .aasx files can be granted.')
    }
    const checked = purpose === 'open' ? await stat(path).catch(() => null) : await stat(dirname(path)).catch(() => null)
    if (!checked || (purpose === 'open' ? !checked.isFile() : !checked.isDirectory())) {
      throw new StudioProblem('not_found', 'The file or folder does not exist.')
    }
    const now = Date.now()
    for (const [handle, grant] of this.#grants) {
      if (grant.expiresAt < now) {
        this.#grants.delete(handle)
      }
    }
    const handle = randomBytes(24).toString('base64url')
    this.#grants.set(handle, { path, purpose, expiresAt: now + grantTtlMs })
    return { handle, fileName: basename(path) }
  }

  async open (handle: string): Promise<WorkspaceInfo> {
    return this.client.request({ op: 'open', path: this.#take(handle, 'open') })
  }

  list (): Promise<WorkspaceInfo[]> {
    return this.client.request({ op: 'list' })
  }

  async info (workspaceId: string): Promise<WorkspaceInfo> {
    const info = (await this.list()).find(workspace => workspace.workspaceId === workspaceId)
    if (!info) {
      throw new StudioProblem('not_found', 'This workspace is not open.')
    }
    return info
  }

  target (workspaceId: string): AasTarget {
    return new WorkspaceAasTarget(this.client, workspaceId)
  }

  save (workspaceId: string): Promise<WorkspaceInfo> {
    return this.client.request({ op: 'save', workspaceId })
  }

  async saveAs (workspaceId: string, handle: string): Promise<WorkspaceInfo> {
    return this.client.request({ op: 'save', workspaceId, path: this.#take(handle, 'save') })
  }

  async close (workspaceId: string, force: boolean): Promise<void> {
    const info = await this.info(workspaceId)
    if (info.unsavedChanges && !force) {
      throw new StudioProblem('workspace_unsaved_changes')
    }
    await this.client.request({ op: 'close', workspaceId })
  }

  dispose (): void {
    this.client.close()
  }

  #take (handle: string, purpose: FileGrantPurpose): string {
    const grant = this.#grants.get(handle)
    this.#grants.delete(handle)
    if (!grant || grant.purpose !== purpose || grant.expiresAt < Date.now()) {
      throw new StudioProblem('invalid_request', 'The file selection expired. Choose the file again.')
    }
    return grant.path
  }
}
