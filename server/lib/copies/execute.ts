import type { IdScheme } from '#shared/aas/identifiers'
import type { CollisionPolicy, CopyDependencies, CopyReport, CopyResourceOutcome, CopyResourcePlan, SyncStep } from '#shared/contract'
import type { JsonObject } from '../aas/outline'
import type { SyncPlan } from '../aas/sync'
import type { AasTarget } from '../targets/aas-target'
import type { CopyReader } from './source'
import { generateId } from '#shared/aas/identifiers'
import { shellMetadata, verifyConceptDescription, verifyShell, verifySubmodel } from '../aas/edits'
import { encodeKey } from '../aas/keys'
import { submodelIdsOf } from '../aas/sync'
import { StudioProblem } from '../problem'
import { revisionOf } from '../targets/revision'
import { hasPackagedThumbnail, packagedFilePaths, rewriteReferences } from './content'
import { existsAt } from './plan'

/**
 * What earlier executions of a plan did (K8): the identifiers they gave and
 * the resources they wrote, so a retry neither duplicates nor renames them.
 * A resource is written once its identifiable is; it is `complete` once its
 * files, thumbnail and shell reference are too, so a retry resumes those.
 */
export interface CopyRun {
  identifiers: Map<string, string>
  written: Map<string, { outcome: CopyResourceOutcome, complete: boolean }>
}

export function newCopyRun (): CopyRun {
  return { identifiers: new Map(), written: new Map() }
}

export interface CopyContext {
  reader: CopyReader
  destination: AasTarget
  scheme: IdScheme
  sync: SyncPlan
  dependencies: CopyDependencies
  /** A copied submodel root is also referenced from this shell. */
  destinationShellId: string | null
  /** The deployment allows file uploads (STUDIO_ALLOW_UPLOADS); copied files are uploads too. */
  filesAllowed: boolean
  /** The revisions of the resources as the plan read them, by plan key (K4). */
  revisions: ReadonlyMap<string, string>
}

const order: Record<CopyResourcePlan['resourceType'], number> = { conceptDescription: 0, submodel: 1, shell: 2 }

function problemText (error: unknown): string {
  return error instanceof StudioProblem ? (error.detail ?? error.title) : 'Internal error.'
}

async function read (reader: CopyReader, resource: CopyResourcePlan): Promise<JsonObject> {
  switch (resource.resourceType) {
    case 'shell': {
      return reader.shell(resource.identifier)
    }
    case 'submodel': {
      return reader.submodel(resource.identifier)
    }
    default: {
      return reader.conceptDescription(resource.identifier)
    }
  }
}

/**
 * The resources still to write, read once more: what is written is what the
 * plan showed. A resource that changed at the source since, or a shell whose
 * submodels changed, needs a new plan, before anything is written (K4).
 */
async function readAsPlanned (context: CopyContext, selected: readonly CopyResourcePlan[], run: CopyRun): Promise<Map<string, JsonObject>> {
  const contents = new Map<string, JsonObject>()
  const changed: string[] = []
  for (const resource of selected) {
    if (run.written.get(resource.key)?.complete) {
      continue
    }
    const content = await read(context.reader, resource)
    const planned = context.revisions.get(resource.key)
    if (planned && planned !== revisionOf(content)) {
      changed.push(resource.label)
    }
    contents.set(resource.key, content)
  }
  if (changed.length > 0) {
    throw new StudioProblem('revision_conflict', `The source changed since the plan: ${changed.slice(0, 3).join(', ')}${changed.length > 3 ? ', …' : ''}. Make a new plan.`)
  }
  return contents
}

/** Copies the files of a submodel's File elements; returns how many could not be copied. */
async function copyFiles (context: CopyContext, sourceId: string, destinationId: string, submodel: JsonObject): Promise<number> {
  let failed = 0
  for (const path of packagedFilePaths(submodel)) {
    try {
      const file = await context.reader.attachment(sourceId, path)
      const snapshot = await context.destination.element(destinationId, path)
      await context.destination.replaceAttachment(destinationId, path, file, snapshot.revision)
    } catch {
      failed++
    }
  }
  return failed
}

async function writeResource (context: CopyContext, resource: CopyResourcePlan, content: JsonObject, destinationId: string, replace: boolean): Promise<void> {
  const { destination } = context
  switch (resource.resourceType) {
    case 'conceptDescription': {
      const verified = verifyConceptDescription(content)
      await (replace
        ? destination.replaceConceptDescription(destinationId, verified, revisionOf(await destination.conceptDescription(destinationId)))
        : destination.createConceptDescription(verified))
      return
    }
    case 'submodel': {
      const verified = verifySubmodel(content)
      await (replace
        ? destination.replaceSubmodel(destinationId, verified, revisionOf(await destination.submodel(destinationId)))
        : destination.createSubmodel(verified))
      return
    }
    default: {
      const verified = verifyShell(content)
      if (!replace) {
        await destination.createShell(verified)
        return
      }
      // A replaced shell keeps its references and gets the copied ones it lacks.
      const current = await destination.shell(destinationId)
      await destination.replaceShell(destinationId, verified, revisionOf(shellMetadata(current)))
      const kept = new Set(submodelIdsOf(current))
      for (const submodelId of submodelIdsOf(verified)) {
        if (!kept.has(submodelId)) {
          await destination.addSubmodelRef(destinationId, submodelId)
        }
      }
    }
  }
}

/**
 * Runs a copy plan with a collision policy (K5 to K8): concept descriptions,
 * then submodels with their files, then shells with their thumbnails, then
 * the registries. Each resource reports its own outcome; nothing is undone
 * when a later one fails, as independent targets give no atomicity (DATA-014).
 */
export async function executeCopy (
  context: CopyContext,
  planId: string,
  planned: readonly CopyResourcePlan[],
  policy: CollisionPolicy,
  exclude: ReadonlySet<string>,
  run: CopyRun,
): Promise<CopyReport> {
  const { destination } = context
  const selected = planned
    .filter(resource => !resource.blocked && !exclude.has(resource.key))
    .toSorted((a, b) => order[a.resourceType] - order[b.resourceType])

  // New identifiers for every copied shell and submodel; concept
  // descriptions keep theirs, as an identifier names the concept.
  if (policy === 'new_identifiers') {
    for (const resource of selected) {
      if (resource.resourceType !== 'conceptDescription' && !run.identifiers.has(resource.identifier)) {
        run.identifiers.set(resource.identifier, generateId(resource.resourceType === 'shell' ? 'aas' : 'sm', context.scheme))
      }
    }
  }
  const destinationIdOf = (resource: CopyResourcePlan) => run.identifiers.get(resource.identifier) ?? resource.identifier

  const contents = await readAsPlanned(context, selected, run)

  // Refused before the first write, as the policy promises.
  if (policy === 'fail_without_changes') {
    const taken: string[] = []
    for (const resource of selected) {
      if (!run.written.has(resource.key) && await existsAt(destination, resource.resourceType, destinationIdOf(resource))) {
        taken.push(resource.identifier)
      }
    }
    if (taken.length > 0) {
      throw new StudioProblem('identifier_conflict', `${taken.length} of the resources exist at the destination: ${taken.slice(0, 3).join(', ')}${taken.length > 3 ? ', …' : ''}`)
    }
  }

  const outcomes: CopyResourceOutcome[] = []
  const createdShells: string[] = []
  const createdSubmodels: string[] = []
  const copiesShells = selected.some(item => item.resourceType === 'shell')
  for (const resource of selected) {
    const destinationId = destinationIdOf(resource)
    const earlier = run.written.get(resource.key)
    if (earlier?.complete) {
      outcomes.push({ ...earlier.outcome, status: 'skipped', message: 'Copied by an earlier run of this plan.' })
      continue
    }
    const outcome: CopyResourceOutcome = {
      resourceType: resource.resourceType,
      identifier: resource.identifier,
      destinationIdentifier: destinationId,
      status: 'skipped',
      message: null,
    }
    outcomes.push(outcome)
    const content = { ...rewriteReferences(contents.get(resource.key)!, run.identifiers), id: destinationId }
    let exists: boolean
    try {
      if (earlier) {
        // Written by an earlier run, whose later steps failed: only those run again.
        exists = earlier.outcome.status === 'replaced'
      } else {
        exists = await existsAt(destination, resource.resourceType, destinationId)
        // Kept as they are, unless the policy replaces them; with new
        // identifiers only concept descriptions can collide (K5).
        if (exists && policy !== 'replace') {
          outcome.message = 'It exists at the destination.'
          continue
        }
        await writeResource(context, resource, content, destinationId, exists)
      }
      outcome.status = exists ? 'replaced' : 'created'
      // Checkpoint: the identifiable is written, whatever the next steps do.
      run.written.set(resource.key, { outcome: { ...outcome }, complete: false })
      const notes = await afterWrite(context, resource, content, destinationId)
      outcome.message = notes.length > 0 ? notes.join(' ') : null
      run.written.set(resource.key, { outcome: { ...outcome }, complete: true })
      if (resource.resourceType === 'shell') {
        createdShells.push(destinationId)
      } else if (resource.resourceType === 'submodel' && !exists && (resource.role === 'root' || !copiesShells)) {
        createdSubmodels.push(destinationId)
      }
    } catch (error) {
      // A written identifiable whose later steps failed stays failed until a retry completes them.
      outcome.status = 'failed'
      outcome.message = run.written.has(resource.key)
        ? `Written, but a later step failed: ${problemText(error)} Run the copy again to complete it.`
        : problemText(error)
    }
  }
  return reportOf(planId, policy, outcomes, await register(context, createdShells, createdSubmodels))
}

/** The files, thumbnail and shell reference that go with a written resource; notes on what could not be copied. */
async function afterWrite (context: CopyContext, resource: CopyResourcePlan, content: JsonObject, destinationId: string): Promise<string[]> {
  const { destination } = context
  const notes: string[] = []
  const wantsFiles = context.dependencies.supplementaryFiles === 'referenced' && destination.capabilities.files
  const copiesFiles = wantsFiles && context.filesAllowed
  if (resource.resourceType === 'submodel') {
    const failed = copiesFiles ? await copyFiles(context, resource.identifier, destinationId, content) : 0
    if (failed > 0) {
      notes.push(`${failed} file(s) could not be copied.`)
    }
    const withheld = wantsFiles && !context.filesAllowed ? packagedFilePaths(content).length : 0
    if (withheld > 0) {
      notes.push(`${withheld} file(s) were not copied: this deployment does not allow file uploads.`)
    }
    const shellId = resource.role === 'root' ? context.destinationShellId : null
    if (shellId && !submodelIdsOf(await destination.shell(shellId)).includes(destinationId)) {
      await destination.addSubmodelRef(shellId, destinationId)
    }
  }
  if (resource.resourceType === 'shell' && copiesFiles && hasPackagedThumbnail(content)) {
    try {
      const thumbnail = await context.reader.thumbnail(resource.identifier)
      if (thumbnail) {
        await destination.setThumbnail(destinationId, thumbnail)
      }
    } catch {
      notes.push('The thumbnail could not be copied.')
    }
  }
  return notes
}

/** Descriptors and asset links where Studio keeps the registries in step (DATA-020). */
async function register (context: CopyContext, shells: string[], submodels: string[]): Promise<SyncStep[]> {
  const sync: SyncStep[] = []
  try {
    if (shells.length > 0) {
      sync.push(...await context.destination.registerShells(shells, context.sync))
    }
    if (submodels.length > 0) {
      sync.push(...await context.destination.registerSubmodels(submodels, context.sync))
    }
  } catch (error) {
    sync.push({ resource: 'shellDescriptor', id: shells[0] ?? submodels[0] ?? '', outcome: 'failed', detail: problemText(error) })
  }
  return sync
}

function reportOf (planId: string, policy: CollisionPolicy, outcomes: CopyResourceOutcome[], sync: SyncStep[]): CopyReport {
  const count = (status: CopyResourceOutcome['status']) => outcomes.filter(outcome => outcome.status === status).length
  const failed = count('failed')
  const firstShell = outcomes.find(outcome => outcome.resourceType === 'shell' && outcome.status !== 'failed')
  const firstSubmodel = outcomes.find(outcome => outcome.resourceType === 'submodel' && outcome.status !== 'failed')
  let status: CopyReport['status'] = 'partial_success'
  if (failed === 0) {
    status = 'succeeded'
  } else if (failed === outcomes.length) {
    status = 'failed'
  }
  return {
    planId,
    status,
    collisionPolicy: policy,
    sourceUnchanged: true,
    atomic: false,
    counts: { planned: outcomes.length, created: count('created'), replaced: count('replaced'), skipped: count('skipped'), failed },
    outcomes,
    sync,
    shellKey: firstShell ? encodeKey(firstShell.destinationIdentifier) : null,
    submodelKey: firstSubmodel ? encodeKey(firstSubmodel.destinationIdentifier) : null,
  }
}
