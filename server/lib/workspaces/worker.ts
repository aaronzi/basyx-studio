import type { OpenedPackage } from './package'
import type { WorkerProblem, WorkerRequest, WorkerResponse, WorkerResults, WorkspaceCalls, WorkspaceInfo, WorkspaceMethod } from './protocol'
import { randomBytes } from 'node:crypto'
import { readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { StudioProblem } from '../problem'
import { defaultArchiveLimits } from './archive'
import { WorkspaceModel } from './model'
import { readPackage, writePackage } from './package'

interface OpenWorkspace {
  path: string
  opened: OpenedPackage
  model: WorkspaceModel
  diagnostics: string[]
}

const callable = new Set<string>(['listShells', 'shell', 'submodelIds', 'submodelMetadata', 'submodel', 'element', 'setElementValue'])

/**
 * The Workspace Worker's request handling: opened packages, their models,
 * and atomic saves. Runs in its own process (see `server/workers`), so a
 * malformed package can only take down the worker, not the Studio Service.
 */
export class WorkspaceWorker {
  readonly #workspaces = new Map<string, OpenWorkspace>()

  async handle (request: WorkerRequest): Promise<WorkerResults[WorkerRequest['op']]> {
    switch (request.op) {
      case 'open': {
        return this.#open(request.path)
      }
      case 'call': {
        const workspace = this.#get(request.workspaceId)
        if (!callable.has(request.method)) {
          throw new StudioProblem('invalid_request', 'Unknown workspace operation.')
        }
        const method = workspace.model[request.method] as (...args: unknown[]) => ReturnType<WorkspaceCalls[WorkspaceMethod]>
        return method.apply(workspace.model, request.args)
      }
      case 'save': {
        return this.#save(request.workspaceId, request.path)
      }
      case 'close': {
        this.#workspaces.delete(request.workspaceId)
        return null
      }
      default: {
        return [...this.#workspaces.keys()].map(id => this.#info(id))
      }
    }
  }

  async #open (path: string): Promise<WorkspaceInfo> {
    const size = (await stat(path)).size
    if (size > defaultArchiveLimits.maxArchiveBytes) {
      throw new StudioProblem('package_rejected', 'The package is too large.')
    }
    const opened = await readPackage(new Uint8Array(await readFile(path)))
    const workspaceId = `ws-${randomBytes(9).toString('base64url')}`
    this.#workspaces.set(workspaceId, { path, opened, model: new WorkspaceModel(opened.environment), diagnostics: opened.diagnostics })
    return this.#info(workspaceId)
  }

  /** Writes a temporary file next to the target and renames it over it, so a crash never leaves a partial package. */
  async #save (workspaceId: string, target: string | undefined): Promise<WorkspaceInfo> {
    const workspace = this.#get(workspaceId)
    const path = target ?? workspace.path
    const revision = workspace.model.revision
    const bytes = await writePackage(workspace.opened, workspace.model.environment)
    const temporary = join(dirname(path), `.${basename(path)}.${randomBytes(6).toString('hex')}.tmp`)
    try {
      await writeFile(temporary, bytes, { flag: 'wx' })
      await rename(temporary, path)
    } catch (error) {
      await rm(temporary, { force: true })
      throw error
    }
    workspace.path = path
    workspace.model.savedRevision = revision
    return this.#info(workspaceId)
  }

  #get (workspaceId: string): OpenWorkspace {
    const workspace = this.#workspaces.get(workspaceId)
    if (!workspace) {
      throw new StudioProblem('not_found', 'This workspace is not open.')
    }
    return workspace
  }

  #info (workspaceId: string): WorkspaceInfo {
    const workspace = this.#get(workspaceId)
    return {
      workspaceId,
      fileName: basename(workspace.path),
      unsavedChanges: workspace.model.unsavedChanges,
      diagnostics: workspace.diagnostics,
    }
  }
}

function toProblem (error: unknown): WorkerProblem {
  if (error instanceof StudioProblem) {
    return { code: error.code, detail: error.detail, violations: error.violations }
  }
  const code = (error as NodeJS.ErrnoException | null)?.code
  if (code === 'ENOENT') {
    return { code: 'not_found', detail: 'The file does not exist (anymore).' }
  }
  if (code === 'EACCES' || code === 'EPERM') {
    return { code: 'forbidden', detail: 'Studio may not access this file.' }
  }
  return { code: 'internal_error', detail: error instanceof Error ? error.message : undefined }
}

/** Serves requests from the parent process over the IPC channel. */
export function serveWorker (worker = new WorkspaceWorker()): void {
  // Requests are handled one at a time, so no two operations interleave.
  let queue = Promise.resolve()
  process.on('message', (message: { id: number, request: WorkerRequest }) => {
    queue = queue.then(async () => {
      let response: WorkerResponse
      try {
        response = { id: message.id, ok: true, result: await worker.handle(message.request) }
      } catch (error) {
        response = { id: message.id, ok: false, problem: toProblem(error) }
      }
      process.send?.(response)
    })
  })
  // Without the parent there is no one to serve; never outlive it.
  process.on('disconnect', () => process.exit(0))
}
