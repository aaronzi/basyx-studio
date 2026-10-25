import type { CollisionPolicy, CopyDependencies, CopyResourcePlan, CopyResourceType } from '#shared/contract'
import type { JsonObject } from '../aas/outline'
import type { AasTarget } from '../targets/aas-target'
import type { CopyReader } from './source'
import { verifyConceptDescription, verifyShell, verifySubmodel } from '../aas/edits'
import { submodelIdsOf } from '../aas/sync'
import { StudioProblem } from '../problem'
import { revisionOf } from '../targets/revision'
import { hasPackagedThumbnail, packagedFilePaths, semanticIdsOf } from './content'

/** A resource the user chose to copy. */
export interface CopyRoot {
  type: CopyResourceType
  id: string
}

export interface PlannedCopy {
  resources: CopyResourcePlan[]
  /** The revision of each resource as read, by plan key, which the execution checks (K4). */
  revisions: Map<string, string>
  allowedCollisionPolicies: CollisionPolicy[]
  defaultCollisionPolicy: CollisionPolicy
  notes: string[]
}

export interface PlanInput {
  reader: CopyReader
  roots: readonly CopyRoot[]
  destination: AasTarget
  dependencies: CopyDependencies
  /** Source and destination are the same target. */
  sameTarget: boolean
  /** The deployment allows file uploads (STUDIO_ALLOW_UPLOADS). */
  filesAllowed: boolean
}

function problemText (error: unknown): string {
  return error instanceof StudioProblem ? (error.detail ?? error.title) : 'Internal error.'
}

/** A resource the source does not have, or a repository it does not have: expected, unlike failures. */
export function isAbsent (error: unknown): boolean {
  return error instanceof StudioProblem && (error.code === 'target_resource_not_found' || error.code === 'unsupported_operation')
}

/** Whether the destination has a resource with this identifier; other failures are not "free". */
export async function existsAt (destination: AasTarget, type: CopyResourceType, id: string): Promise<boolean> {
  try {
    if (type === 'shell') {
      await destination.shell(id)
    } else if (type === 'submodel') {
      await destination.submodelMetadata(id)
    } else {
      await destination.conceptDescription(id)
    }
    return true
  } catch (error) {
    if (error instanceof StudioProblem && error.code === 'target_resource_not_found') {
      return false
    }
    throw error
  }
}

/** AAS Core findings of a resource, as the copy would write it. */
function findingsOf (type: CopyResourceType, content: JsonObject): string[] {
  try {
    if (type === 'shell') {
      verifyShell(content)
    } else if (type === 'submodel') {
      verifySubmodel(content)
    } else {
      verifyConceptDescription(content)
    }
    return []
  } catch (error) {
    if (error instanceof StudioProblem && error.code === 'validation_failed') {
      return (error.violations ?? [{ path: '', message: error.detail ?? error.title }]).slice(0, 20).map(item => item.path ? `${item.path}: ${item.message}` : item.message)
    }
    throw error
  }
}

/** The English display name, else the first, else the idShort or identifier. */
function labelOf (content: JsonObject): string {
  const names = Array.isArray(content.displayName) ? content.displayName as Array<{ language?: unknown, text?: unknown }> : []
  const name = names.find(item => item.language === 'en') ?? names[0]
  if (typeof name?.text === 'string' && name.text !== '') {
    return name.text
  }
  return typeof content.idShort === 'string' ? content.idShort : String(content.id)
}

async function read (reader: CopyReader, type: CopyResourceType, id: string): Promise<JsonObject> {
  if (type === 'shell') {
    return reader.shell(id)
  }
  return type === 'submodel' ? reader.submodel(id) : reader.conceptDescription(id)
}

/**
 * The plan of a copy (K4): the chosen resources, their submodels and the
 * concept descriptions their semantic IDs name, each with its state at the
 * destination, its files and its AAS Core findings. Planning writes nothing.
 */
export async function planCopy (input: PlanInput): Promise<PlannedCopy> {
  const { reader, destination, dependencies } = input
  const resources: CopyResourcePlan[] = []
  const revisions = new Map<string, string>()
  const seen = new Set<string>()
  const notes: string[] = []
  const semantics = new Set<string>()
  const keepsConcepts = destination.capabilities.conceptDescriptions

  const add = async (type: CopyResourceType, id: string, role: CopyResourcePlan['role'], shellIdentifier: string | null) => {
    if (seen.has(`${type}:${id}`)) {
      return null
    }
    seen.add(`${type}:${id}`)
    const entry: CopyResourcePlan = {
      key: `r${resources.length}`,
      resourceType: type,
      identifier: id,
      label: id,
      role,
      shellIdentifier,
      exists: false,
      blocked: null,
      files: 0,
      findings: [],
    }
    resources.push(entry)
    let content: JsonObject
    try {
      content = await read(reader, type, id)
    } catch (error) {
      entry.blocked = problemText(error)
      return null
    }
    entry.label = labelOf(content)
    revisions.set(entry.key, revisionOf(content))
    entry.findings = findingsOf(type, content)
    if (entry.findings.length > 0) {
      entry.blocked = 'AAS Core reports findings.'
    }
    if (type === 'conceptDescription' && !keepsConcepts) {
      entry.blocked = 'The destination keeps no concept descriptions.'
    } else {
      entry.exists = await existsAt(destination, type, id)
    }
    if (dependencies.supplementaryFiles === 'referenced') {
      entry.files = type === 'submodel' ? packagedFilePaths(content).length : (type === 'shell' && hasPackagedThumbnail(content) ? 1 : 0)
    }
    return content
  }

  for (const root of input.roots) {
    const content = await add(root.type, root.id, 'root', null)
    if (!content) {
      continue
    }
    if (root.type === 'submodel') {
      for (const id of semanticIdsOf(content)) {
        semantics.add(id)
      }
    }
    if (root.type === 'shell' && dependencies.submodels === 'referenced') {
      for (const submodelId of submodelIdsOf(content)) {
        const submodel = await add('submodel', submodelId, 'dependency', root.id)
        if (submodel) {
          for (const id of semanticIdsOf(submodel)) {
            semantics.add(id)
          }
        }
      }
    }
  }

  // Only the concept descriptions the source has; most semantic IDs name
  // concepts kept elsewhere (ECLASS, IDTA), which are not copied.
  if (dependencies.conceptDescriptions === 'referenced') {
    for (const id of semantics) {
      if (seen.has(`conceptDescription:${id}`)) {
        continue
      }
      // Concepts kept elsewhere are expected; an unreachable source is not.
      try {
        await reader.conceptDescription(id)
      } catch (error) {
        if (isAbsent(error)) {
          continue
        }
        throw error
      }
      await add('conceptDescription', id, 'dependency', null)
    }
  }

  if (!keepsConcepts && resources.some(resource => resource.resourceType === 'conceptDescription')) {
    notes.push('The destination keeps no concept descriptions; they are left out.')
  }
  if (!destination.capabilities.files && resources.some(resource => resource.files > 0)) {
    notes.push('The destination keeps no files; File elements keep their paths.')
  } else if (!input.filesAllowed && resources.some(resource => resource.files > 0)) {
    notes.push('This deployment does not allow file uploads; File elements keep their paths.')
  }

  const collides = resources.some(resource => resource.exists && !resource.blocked)
  const allowed: CollisionPolicy[] = ['fail_without_changes', 'skip_existing', 'new_identifiers']
  // Replacing a resource with itself changes nothing; across targets it needs structural writes.
  if (!input.sameTarget && destination.capabilities.writeStructure) {
    allowed.splice(2, 0, 'replace')
  }
  let defaultPolicy: CollisionPolicy = 'fail_without_changes'
  if (input.sameTarget) {
    defaultPolicy = 'new_identifiers'
  } else if (collides) {
    defaultPolicy = 'skip_existing'
  }
  return { resources, revisions, allowedCollisionPolicies: allowed, defaultCollisionPolicy: defaultPolicy, notes }
}
