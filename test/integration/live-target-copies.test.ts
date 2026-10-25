import type { CopyDependencies } from '#shared/contract'
import { afterAll, describe, expect, it } from 'vitest'
import { executeCopy, newCopyRun } from '~~/server/lib/copies/execute'
import { planCopy } from '~~/server/lib/copies/plan'
import { LiveAasTarget } from '~~/server/lib/targets/live-target'
import { WorkspaceModel } from '~~/server/lib/workspaces/model'
import { defaultSyncSettings } from '#shared/contract'
import { copyEnvironment, copyIds, manual, memoryFiles, packageTarget } from '../support/copies'
import { policy, record } from '../support/live'
import { openTargetUrl, testenvAvailable } from '../support/testenv'

// Copies between a package and the open BaSyx Go environment (package editing
// plan, K3 to K8): files through the attachment API, concept descriptions in
// the repository, and registries and discovery kept in step (DATA-020).

const encode = (id: string) => Buffer.from(id).toString('base64url')
const live = new LiveAasTarget({
  record: {
    ...record(openTargetUrl, { mode: 'unsecured' }),
    template: 'mono-all',
    endpoints: [{ type: 'aasEnvironment', url: openTargetUrl }],
    sync: { ...defaultSyncSettings, serverSyncsRegistry: false, serverSyncsDiscovery: false },
  },
  access: { accessToken: undefined, downstreamIdentity: null },
  policy: policy(openTargetUrl),
  requestId: 'test-request',
  onUnauthorized: async () => {},
})
const dependencies: CopyDependencies = { submodels: 'referenced', conceptDescriptions: 'referenced', supplementaryFiles: 'referenced' }
const sync = { registry: true, submodelRegistry: true, discovery: true }
const scheme = { type: 'iri', prefix: 'https://studio.test/ids/' } as const

describe.runIf(testenvAvailable)('copies between a package and a live target', () => {
  const prefix = `urn:studio:test:copy:${Date.now()}`
  const ids = copyIds(prefix)
  afterAll(async () => {
    await fetch(`${openTargetUrl}/shells/${encode(ids.shellId)}`, { method: 'DELETE' })
    await fetch(`${openTargetUrl}/shell-descriptors/${encode(ids.shellId)}`, { method: 'DELETE' })
    await fetch(`${openTargetUrl}/lookup/shells/${encode(ids.shellId)}`, { method: 'DELETE' })
    for (const id of [ids.nameplateId, ids.documentsId]) {
      await fetch(`${openTargetUrl}/submodels/${encode(id)}`, { method: 'DELETE' })
      await fetch(`${openTargetUrl}/submodel-descriptors/${encode(id)}`, { method: 'DELETE' })
    }
    await fetch(`${openTargetUrl}/concept-descriptions/${encode(ids.conceptId)}`, { method: 'DELETE' })
  })

  it('copies a shell from a package with its submodels, concept description and file, and registers it', async () => {
    const source = packageTarget(new WorkspaceModel(copyEnvironment(prefix), memoryFiles([['/aasx/manual.pdf', manual]])))
    const plan = await planCopy({ reader: source, roots: [{ type: 'shell', id: ids.shellId }], destination: live, dependencies, sameTarget: false, filesAllowed: true })
    expect(plan.resources.filter(resource => !resource.blocked)).toHaveLength(4)
    const report = await executeCopy({ reader: source, destination: live, scheme, sync, dependencies, destinationShellId: null, filesAllowed: true, revisions: plan.revisions }, 'p1', plan.resources, 'fail_without_changes', new Set(), newCopyRun())

    expect(report.status).toBe('succeeded')
    expect(report.outcomes.every(outcome => outcome.message === null)).toBe(true)
    expect((await live.shell(ids.shellId)).idShort).toBe('Motor')
    expect((await live.conceptDescription(ids.conceptId)).idShort).toBe('SerialNumber')
    expect((await live.attachment(ids.documentsId, 'Files[0]')).bytes).toEqual(manual.bytes)
    // The shell keeps its reference to the missing submodel, which has no descriptor to write.
    expect(report.sync.filter(step => step.outcome === 'failed').map(step => step.id)).toEqual([`${prefix}:sm:missing`])
    expect((await fetch(`${openTargetUrl}/shell-descriptors/${encode(ids.shellId)}`)).status).toBe(200)
  })

  it('copies the shell back into an empty package, file included', async () => {
    const files = memoryFiles()
    const model = new WorkspaceModel({ assetAdministrationShells: [], submodels: [], conceptDescriptions: [] }, files)
    const destination = packageTarget(model)
    const plan = await planCopy({ reader: live, roots: [{ type: 'shell', id: ids.shellId }], destination, dependencies, sameTarget: false, filesAllowed: true })
    const report = await executeCopy({ reader: live, destination, scheme, sync, dependencies, destinationShellId: null, filesAllowed: true, revisions: plan.revisions }, 'p2', plan.resources, 'fail_without_changes', new Set(), newCopyRun())

    expect(report.counts).toMatchObject({ created: 4, failed: 0 })
    expect((await model.attachment(ids.documentsId, 'Files[0]')).bytes).toEqual(manual.bytes)
  })

  it('finds every resource at the destination when planning the same copy again', async () => {
    const source = packageTarget(new WorkspaceModel(copyEnvironment(prefix), memoryFiles([['/aasx/manual.pdf', manual]])))
    const plan = await planCopy({ reader: source, roots: [{ type: 'shell', id: ids.shellId }], destination: live, dependencies, sameTarget: false, filesAllowed: true })
    expect(plan.resources.filter(resource => !resource.blocked).every(resource => resource.exists)).toBe(true)
    expect(plan.defaultCollisionPolicy).toBe('skip_existing')
  })
})
