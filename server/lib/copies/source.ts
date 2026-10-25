import type { JsonObject } from '../aas/outline'
import type { AasTarget, BinaryContent } from '../targets/aas-target'
import type { PackagedFile } from '../workspaces/package'
import { StudioProblem } from '../problem'

/**
 * What a copy reads (package editing plan, K3): a target through its
 * `AasTarget`, or an environment from pasted text or an imported file.
 */
export type CopyReader = Pick<AasTarget, 'shell' | 'submodel' | 'conceptDescription' | 'attachment' | 'thumbnail'>

function objects (value: unknown): JsonObject[] {
  return Array.isArray(value) ? value.filter((item): item is JsonObject => typeof item === 'object' && item !== null && !Array.isArray(item)) : []
}

function notFound (what: string): never {
  throw new StudioProblem('target_resource_not_found', `The ${what} is not part of the copied content.`)
}

/** Normalizes a path inside a package for comparison: no leading slash. */
function packagePath (path: string): string {
  return path.replace(/^\/+/, '')
}

/** Whether a File value points into the package (not to a URL). */
export function isPackagePath (value: unknown): value is string {
  return typeof value === 'string' && value !== '' && !/^[a-z][\w+.-]*:/i.test(value)
}

/** The element at an idShortPath (`A.B[0].C`) inside a submodel. */
function elementAt (submodel: JsonObject, idShortPath: string): JsonObject | undefined {
  let children = objects(submodel.submodelElements)
  let current: JsonObject | undefined
  for (const step of idShortPath.match(/[^.[\]]+|\[\d+\]/g) ?? []) {
    current = step.startsWith('[') ? children[Number(step.slice(1, -1))] : children.find(child => child.idShort === step)
    if (!current) {
      return undefined
    }
    children = objects(current.value ?? current.statements ?? current.annotations)
  }
  return current
}

/** An AAS environment, e.g. from the system clipboard or an imported AASX with its files. */
export class EnvironmentReader implements CopyReader {
  readonly #environment: JsonObject
  readonly #files: Map<string, PackagedFile>

  constructor (environment: JsonObject, files: readonly PackagedFile[] = []) {
    this.#environment = environment
    this.#files = new Map(files.map(file => [packagePath(file.path), file]))
  }

  get shells (): JsonObject[] {
    return objects(this.#environment.assetAdministrationShells)
  }

  get submodels (): JsonObject[] {
    return objects(this.#environment.submodels)
  }

  get conceptDescriptions (): JsonObject[] {
    return objects(this.#environment.conceptDescriptions)
  }

  async shell (id: string): Promise<JsonObject> {
    return this.shells.find(shell => shell.id === id) ?? notFound('shell')
  }

  async submodel (id: string): Promise<JsonObject> {
    return this.submodels.find(submodel => submodel.id === id) ?? notFound('submodel')
  }

  async conceptDescription (id: string): Promise<JsonObject> {
    return this.conceptDescriptions.find(cd => cd.id === id) ?? notFound('concept description')
  }

  async attachment (submodelId: string, idShortPath: string): Promise<BinaryContent> {
    const element = elementAt(await this.submodel(submodelId), idShortPath)
    const file = isPackagePath(element?.value) ? this.#files.get(packagePath(element.value)) : undefined
    if (!file) {
      notFound('file')
    }
    const contentType = typeof element?.contentType === 'string' ? element.contentType : file.contentType
    return { bytes: file.bytes, contentType, fileName: file.path.split('/').pop() || null }
  }

  async thumbnail (shellId: string): Promise<BinaryContent | null> {
    const path = ((await this.shell(shellId)).assetInformation as JsonObject | undefined)?.defaultThumbnail as JsonObject | undefined
    const file = isPackagePath(path?.path) ? this.#files.get(packagePath(path.path)) : undefined
    return file ? { bytes: file.bytes, contentType: file.contentType, fileName: file.path.split('/').pop() || null } : null
  }
}
