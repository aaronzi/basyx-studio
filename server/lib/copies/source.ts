import type { JsonObject } from '../aas/outline'
import type { AasTarget, BinaryContent } from '../targets/aas-target'
import type { PackagedFile } from '../workspaces/package'
import { parseLocator } from '../aas/keys'
import { navigate, submodelChildren } from '../aas/outline'
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

/** The element at a locator (`A.B[0].C`, `Run@input.Manual`) inside a submodel. */
function elementAt (submodel: JsonObject, locator: string): JsonObject | undefined {
  const [first, ...rest] = parseLocator(locator)
  const top = first?.kind === 'idShort' ? submodelChildren(submodel).find(child => child.label === first.idShort) : undefined
  const found = top && isObject(top.value) ? navigate(top.value, rest) : undefined
  return isObject(found) ? found : undefined
}

function isObject (value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
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
