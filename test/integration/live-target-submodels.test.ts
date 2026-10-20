import type { InfrastructureRecord } from '~~/server/lib/infrastructures'
import { beforeAll, describe, expect, it } from 'vitest'
import { StudioProblem } from '~~/server/lib/problem'
import { LiveAasTarget } from '~~/server/lib/targets/live-target'
import { policy, record } from '../support/live'
import { openTargetUrl, testenvAvailable } from '../support/testenv'

// The submodel view against the open BaSyx Go AAS environment: submodels on
// their own from the submodel registry or repository, their search, and the
// shells that reference them (by query, or by reading the shells).

const motorShell = 'urn:fraunhofer:iese:dte:aas:drivemotor-dm3000:001'
const motorNameplate = 'urn:fraunhofer:iese:dte:sm:nameplate:drivemotor-dm3000:001'

let profiles: string[] = []

function target (listSource: InfrastructureRecord['listSource'], announced = true) {
  return new LiveAasTarget({
    record: {
      ...record(openTargetUrl, { mode: 'unsecured' }),
      template: 'mono-all',
      endpoints: [{ type: 'aasEnvironment', url: openTargetUrl }],
      listSource,
      serviceProfiles: { aasEnvironment: announced ? profiles : [] },
    },
    access: { accessToken: undefined, downstreamIdentity: null },
    policy: policy(openTargetUrl),
    requestId: 'test-request',
    onUnauthorized: async () => {},
  })
}

/** Every page of the submodel list. */
async function allSubmodels (live: LiveAasTarget) {
  const items = []
  let cursor: string | undefined
  do {
    const page = await live.listSubmodels(50, cursor)
    items.push(...page.items)
    cursor = page.page.nextCursor ?? undefined
  } while (cursor)
  return items
}

describe.runIf(testenvAvailable)('LiveAasTarget submodels on their own', () => {
  beforeAll(async () => {
    profiles = (await (await fetch(`${openTargetUrl}/description`)).json() as { profiles: string[] }).profiles
  })

  it.each(['registry', 'repository'] as const)('lists submodels, cursor-paged, from the %s', async listSource => {
    const live = target(listSource)
    expect(live.capabilities.submodelListSource).toBe(listSource)
    const first = await live.listSubmodels(2, undefined)
    expect(first.items).toHaveLength(2)
    expect(first.page.hasMore).toBe(true)
    const nameplate = (await allSubmodels(live)).find(item => item.id === motorNameplate)
    expect(nameplate).toMatchObject({ idShort: 'Nameplate', semanticId: 'https://admin-shell.io/idta/nameplate/3/0/Nameplate' })
    // The repository's metadata names the kind; registry descriptors do not.
    expect(nameplate?.kind).toBe(listSource === 'repository' ? 'Instance' : null)
  })

  it('searches submodels on the repository, by expression or raw query', async () => {
    const live = target('registry')
    const found = await live.searchSubmodels({ expression: 'semanticId:idta/nameplate' }, 50, undefined)
    expect(found.endpoint).toBe('repository')
    expect(found.items.map(item => item.id)).toContain(motorNameplate)
    const exact = await live.searchSubmodels({ query: { $condition: { $eq: [{ $field: '$sm#id' }, { $strVal: motorNameplate }] } } }, 50, undefined)
    expect(exact.items.map(item => item.id)).toEqual([motorNameplate])
    const wrongRoot = await live.searchSubmodels({ query: { $condition: { $eq: [{ $field: '$aas#id' }, { $strVal: motorShell }] } } }, 50, undefined).catch((error: unknown) => error)
    expect(wrongRoot).toMatchObject({ code: 'query_invalid' })
  })

  it('refuses searches without a query endpoint', async () => {
    const error = await target('repository', false).searchSubmodels({ expression: 'nameplate' }, 10, undefined).catch((error_: unknown) => error_)
    expect(error).toBeInstanceOf(StudioProblem)
    expect((error as StudioProblem).code).toBe('query_unsupported')
  })

  it('finds the shells that reference a submodel by query, and by reading the shells without one', async () => {
    const byQuery = await target('repository').submodelOwners([motorNameplate, 'urn:studio:test:sm:nobody'])
    expect(byQuery).toMatchObject({ method: 'query', complete: true, scanned: null })
    expect(byQuery.shells[motorNameplate]!.map(shell => shell.id)).toEqual([motorShell])
    expect(byQuery.shells['urn:studio:test:sm:nobody']).toEqual([])

    for (const listSource of ['repository', 'registry'] as const) {
      const byScan = await target(listSource, false).submodelOwners([motorNameplate])
      expect(byScan).toMatchObject({ method: 'scan', complete: true })
      expect(byScan.scanned).toBeGreaterThan(0)
      expect(byScan.shells[motorNameplate]!.map(shell => shell.id)).toEqual([motorShell])
    }
  })
})
