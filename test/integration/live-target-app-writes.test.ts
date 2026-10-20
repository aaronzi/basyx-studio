import type { AppWritesTarget } from '../support/app-writes'
import { afterAll, describe, expect, it } from 'vitest'
import { executeAasMethod } from '~~/server/lib/apps/calls'
import { LiveAasTarget } from '~~/server/lib/targets/live-target'
import { defaultSyncSettings } from '#shared/contract'
import { appWritesContract } from '../support/app-writes'
import { policy, record } from '../support/live'
import { openTargetUrl, testenvAvailable } from '../support/testenv'

// The structural app methods (MVP-7 A1, A2) against the open BaSyx Go
// environment, with registries and discovery kept in step by Studio as the
// editor does (DATA-020).

const encode = (id: string) => Buffer.from(id).toString('base64url')
const target = new LiveAasTarget({
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
const context = {
  target,
  idScheme: { type: 'iri', prefix: 'https://studio.test/ids/' } as const,
  syncPlan: async () => ({ registry: true, submodelRegistry: true, discovery: true }),
}

describe.runIf(testenvAvailable)('app structural writes on a live target', () => {
  const created: AppWritesTarget['created'] = { shells: [], submodels: [] }
  afterAll(async () => {
    for (const id of created.shells) {
      await fetch(`${openTargetUrl}/shells/${encode(id)}`, { method: 'DELETE' })
      await fetch(`${openTargetUrl}/shell-descriptors/${encode(id)}`, { method: 'DELETE' })
      await fetch(`${openTargetUrl}/lookup/shells/${encode(id)}`, { method: 'DELETE' })
    }
    for (const id of created.submodels) {
      await fetch(`${openTargetUrl}/submodels/${encode(id)}`, { method: 'DELETE' })
      await fetch(`${openTargetUrl}/submodel-descriptors/${encode(id)}`, { method: 'DELETE' })
    }
  })

  appWritesContract(() => ({ context, idPattern: /^https:\/\/studio\.test\/ids\//, created }))

  it('keeps registries and discovery in step, as the editor does', async () => {
    const { shell, steps } = await executeAasMethod(context, 'studio.aas.createShell', {
      shell: { idShort: 'AppSyncShell', assetInformation: { assetKind: 'Instance', globalAssetId: 'urn:studio:test:asset:app-writes' } },
      submodels: [{ idShort: 'Files' }],
    })
    const shellId = String(shell.id)
    const submodelId = steps.find(step => step.resource === 'submodel')!.id
    created.shells.push(shellId)
    created.submodels.push(submodelId)
    expect(steps.map(step => `${step.resource}:${step.outcome}`)).toEqual(['submodel:written', 'shell:written', 'shellDescriptor:written', 'submodelDescriptor:written', 'assetLinks:written'])
    expect((await fetch(`${openTargetUrl}/shell-descriptors/${encode(shellId)}`)).ok).toBe(true)

    const deleted = await executeAasMethod(context, 'studio.aas.deleteShell', { shellId, deleteSubmodels: true })
    expect(deleted.steps.map(step => `${step.resource}:${step.outcome}`)).toEqual(expect.arrayContaining(['shellDescriptor:removed', 'submodelDescriptor:removed']))
    expect((await fetch(`${openTargetUrl}/shell-descriptors/${encode(shellId)}`)).status).toBe(404)
    expect((await fetch(`${openTargetUrl}/submodel-descriptors/${encode(submodelId)}`)).status).toBe(404)
  })
})
