import type { CopyDependencies, CopyPlan, CopyTargetFacts } from '#shared/contract'
import type { CopyRoot } from '../lib/copies/plan'
import type { EnvironmentReader } from '../lib/copies/source'
import type { StoredCopySource } from '../lib/copies/store'
import type { AasTarget } from '../lib/targets/aas-target'
import type { OpenedTarget } from './target'
import type { RequestEvent } from 'nuxt/server'
import { decodeKey } from '../lib/aas/keys'
import { submodelIdsOf } from '../lib/aas/sync'
import { newCopyRun } from '../lib/copies/execute'
import { planCopy } from '../lib/copies/plan'
import { getInfrastructure } from '../lib/infrastructures'
import { isWorkspaceId } from '../lib/workspaces/manager'
import { requireActor } from './auth'
import { requireWorkspaces } from './desktop'
import { requestIdOf } from './handler'
import { useStudio } from './studio'
import { openTargetFor, requireCapability } from './target'

/** Opens a target of a copy: the source to read, or the destination to write, which must create resources. */
export async function openCopyTarget (event: RequestEvent, targetId: string, role: 'source' | 'destination', shellId?: string): Promise<OpenedTarget> {
  const opened = await openTargetFor({
    actor: await requireActor(event),
    targetId,
    requestId: requestIdOf(event),
    operation: event.url.pathname,
    read: role === 'source',
    shellId,
  })
  if (role === 'destination') {
    await requireCapability(opened, 'createResources')
  }
  return opened
}

/** What a copy may do at a target (DATA-013): its name, whose rights it checks, and what it allows now. */
async function targetFacts (targetId: string, target: AasTarget, filesAllowed: boolean): Promise<CopyTargetFacts> {
  const studio = await useStudio()
  const { capabilities } = target
  const allows = {
    createResources: capabilities.createResources,
    replaceResources: capabilities.writeStructure,
    conceptDescriptions: capabilities.conceptDescriptions,
    files: capabilities.files && filesAllowed,
  }
  if (isWorkspaceId(targetId)) {
    const info = await requireWorkspaces(studio).info(targetId)
    return { targetId, name: info.fileName, kind: 'workspace', identity: 'none', ...allows }
  }
  const record = await getInfrastructure(studio, targetId)
  const identities = { delegated_user: 'user', deployment_client_credentials: 'studio', unsecured: 'none' } as const
  return { targetId, name: record.name, kind: 'live', identity: identities[record.security.mode] ?? 'none', ...allows }
}

/** The roots of an environment: its shells, the submodels no shell of it references, and its concept descriptions. */
export function environmentRoots (reader: EnvironmentReader): CopyRoot[] {
  const referenced = new Set(reader.shells.flatMap(shell => submodelIdsOf(shell)))
  return [
    ...reader.shells.map(shell => ({ type: 'shell' as const, id: String(shell.id) })),
    ...reader.submodels.filter(submodel => !referenced.has(String(submodel.id))).map(submodel => ({ type: 'submodel' as const, id: String(submodel.id) })),
    ...reader.conceptDescriptions.map(cd => ({ type: 'conceptDescription' as const, id: String(cd.id) })),
  ]
}

export interface NewCopyPlan {
  source: StoredCopySource
  sourceLabel: string
  roots: CopyRoot[]
  destinationTargetId: string
  destinationShellKey: string | null
  dependencies: CopyDependencies
}

/** Plans a copy and keeps the plan for its execution (K4, K8). */
export async function createCopyPlan (event: RequestEvent, input: NewCopyPlan): Promise<CopyPlan> {
  const studio = await useStudio()
  const actor = await requireActor(event)
  const destinationShellId = input.destinationShellKey ? decodeKey(input.destinationShellKey, 'shell key') : null
  const destination = await openCopyTarget(event, input.destinationTargetId, 'destination', destinationShellId ?? undefined)
  const sourceTargetId = input.source.kind === 'target' ? input.source.targetId : null
  const shellRoot = input.roots.find(root => root.type === 'shell')
  const sourceTarget = input.source.kind === 'target'
    ? (await openCopyTarget(event, input.source.targetId, 'source', shellRoot?.id)).target
    : null
  const reader = sourceTarget ?? (input.source as Extract<StoredCopySource, { kind: 'environment' }>).reader
  const sameTarget = sourceTargetId === input.destinationTargetId
  const filesAllowed = studio.config.deployment.uploads
  const { revisions, ...planned } = await planCopy({ reader, roots: input.roots, destination: destination.target, dependencies: input.dependencies, sameTarget, filesAllowed })
  const plan: CopyPlan = {
    id: studio.copies.newId(),
    source: sourceTarget && sourceTargetId
      ? await targetFacts(sourceTargetId, sourceTarget, filesAllowed)
      : { targetId: null, name: input.sourceLabel, kind: 'text', identity: 'none', createResources: false, replaceResources: false, conceptDescriptions: false, files: false },
    destination: await targetFacts(input.destinationTargetId, destination.target, filesAllowed),
    sourceTargetId,
    sourceLabel: input.sourceLabel,
    destinationTargetId: input.destinationTargetId,
    destinationShellKey: input.destinationShellKey,
    sameTarget,
    ...planned,
    expiresAt: studio.copies.expiry(),
  }
  studio.copies.put({
    plan,
    owner: actor.subject,
    source: input.source,
    roots: input.roots,
    dependencies: input.dependencies,
    destinationShellId,
    revisions,
    run: newCopyRun(),
    executions: new Map(),
    tail: Promise.resolve(),
  })
  return plan
}
