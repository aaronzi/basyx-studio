import type { ElementValueInput, Page, ShellSummary } from '#shared/contract'
import type { LocatorStep } from '../aas/keys'
import type { JsonObject } from '../aas/outline'
import type { ElementSnapshot } from '../targets/aas-target'
import { parseLocator } from '../aas/keys'
import { submodelIdOf, toShellSummary } from '../aas/shells'
import { withValue } from '../aas/values'
import { StudioProblem } from '../problem'
import { contentHash, parseRevision, revisionOf } from '../targets/revision'

function objects (value: unknown): JsonObject[] {
  return Array.isArray(value) ? value.filter((item): item is JsonObject => typeof item === 'object' && item !== null && !Array.isArray(item)) : []
}

function notFound (): never {
  throw new StudioProblem('target_resource_not_found')
}

/** Elements below a submodel element that the AAS API addresses by idShort. */
function namedChildren (element: JsonObject): unknown {
  switch (element.modelType) {
    case 'SubmodelElementCollection': {
      return element.value
    }
    case 'Entity': {
      return element.statements
    }
    case 'AnnotatedRelationshipElement': {
      return element.annotations
    }
    default: {
      return undefined
    }
  }
}

/**
 * The AAS environment of an opened package, with the operations of a
 * Studio target. Only the Workspace Worker holds it; one worker call runs at
 * a time, so a revision check and the following change cannot interleave.
 */
export class WorkspaceModel {
  /** Increments with every applied change. */
  revision = 0
  savedRevision = 0

  constructor (readonly environment: JsonObject) {}

  get unsavedChanges (): boolean {
    return this.revision !== this.savedRevision
  }

  listShells (limit: number, cursor: string | undefined): Page<ShellSummary> {
    const shells = objects(this.environment.assetAdministrationShells)
    const start = cursor === undefined ? 0 : Number(cursor)
    if (!Number.isInteger(start) || start < 0 || start > shells.length) {
      throw new StudioProblem('invalid_request', 'Malformed cursor.')
    }
    const end = Math.min(start + limit, shells.length)
    return {
      items: shells.slice(start, end).map(shell => toShellSummary(shell)),
      page: { nextCursor: end < shells.length ? String(end) : null, hasMore: end < shells.length },
    }
  }

  shell (id: string): JsonObject {
    return objects(this.environment.assetAdministrationShells).find(shell => shell.id === id) ?? notFound()
  }

  submodelIds (shellId: string): string[] {
    return objects(this.shell(shellId).submodels)
      .map(reference => submodelIdOf(reference))
      .filter((id): id is string => id !== null)
  }

  submodel (id: string): JsonObject {
    return objects(this.environment.submodels).find(submodel => submodel.id === id) ?? notFound()
  }

  submodelMetadata (id: string): JsonObject {
    const { submodelElements: _, ...metadata } = this.submodel(id)
    return metadata
  }

  element (submodelId: string, idShortPath: string): ElementSnapshot {
    const { container, index } = this.#locate(submodelId, idShortPath)
    const value = container[index] as JsonObject
    return { value, revision: revisionOf(value), concurrency: 'strong' }
  }

  setElementValue (submodelId: string, idShortPath: string, value: ElementValueInput['value'], revision: string): ElementSnapshot {
    const token = parseRevision(revision)
    const { container, index } = this.#locate(submodelId, idShortPath)
    if (contentHash(container[index]) !== token.hash) {
      throw new StudioProblem('revision_conflict')
    }
    const { json } = withValue(container[index] as JsonObject, value)
    container[index] = json
    this.revision++
    return { value: json, revision: revisionOf(json), concurrency: 'strong' }
  }

  /** The array holding the addressed element and its position, so it can be replaced. */
  #locate (submodelId: string, idShortPath: string): { container: unknown[], index: number } {
    const steps: LocatorStep[] = parseLocator(idShortPath)
    let container: unknown = this.submodel(submodelId).submodelElements
    let index = -1
    for (const step of steps) {
      if (index !== -1) {
        const parent = (container as unknown[])[index] as JsonObject
        container = step.kind === 'index'
          ? (parent.modelType === 'SubmodelElementList' ? parent.value : undefined)
          : namedChildren(parent)
      }
      if (!Array.isArray(container)) {
        notFound()
      }
      if (step.kind === 'index') {
        index = step.index < container.length ? step.index : notFound()
      } else if (step.kind === 'idShort') {
        index = container.findIndex(item => (item as JsonObject | null)?.idShort === step.idShort)
        if (index === -1) {
          notFound()
        }
      } else {
        throw new StudioProblem('invalid_request', 'Operation variables are not addressable.')
      }
    }
    return { container: container as unknown[], index }
  }
}
