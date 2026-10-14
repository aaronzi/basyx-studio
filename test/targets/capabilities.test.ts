import { describe, expect, it, vi } from 'vitest'
import { endpointUrl } from '~~/server/lib/infrastructures'
import { StudioProblem } from '~~/server/lib/problem'
import { liveCapabilities, workspaceCapabilities } from '~~/server/lib/targets/capabilities'
import { FeatureCache } from '~~/server/lib/targets/features'

const services = { endpoints: [{ type: 'aasRepository' as const, url: 'http://aas/' }, { type: 'submodelRepository' as const, url: 'http://sm' }] }
const environment = { endpoints: [{ type: 'aasEnvironment' as const, url: 'http://env/' }] }

describe('target capabilities', () => {
  it('derives environment-only operations from the endpoint configuration', () => {
    expect(liveCapabilities(services, null)).toMatchObject({ export: false, upload: false, search: 'shells', conceptDescriptions: false, discovery: false, history: false })
    expect(liveCapabilities(environment, null)).toMatchObject({ export: true, upload: true, search: 'elements', conceptDescriptions: true, discovery: true })
    expect(liveCapabilities(environment, { history: true, changeFeed: true, sharing: false })).toMatchObject({ history: true, changeFeed: true, sharing: false })
  })

  it('resolves every service of an AAS environment from its one URL', () => {
    expect(endpointUrl(environment, 'submodelRepository')).toBe('http://env')
    expect(endpointUrl({ endpoints: [...environment.endpoints, { type: 'discovery', url: 'http://discovery' }] }, 'discovery')).toBe('http://discovery')
    expect(endpointUrl(services, 'conceptDescriptionRepository')).toBeUndefined()
  })

  it('offers no server-only features on workspaces', () => {
    expect(workspaceCapabilities).toMatchObject({ operations: false, upload: false, history: false, sharing: false, deleteShells: true, files: true })
  })
})

describe('feature cache', () => {
  const record = { id: 'infra', revision: 1 }
  const features = { history: true, changeFeed: false, sharing: false }

  it('detects once per configuration and expires', async () => {
    let now = 0
    const cache = new FeatureCache(() => now)
    const detect = vi.fn(async () => features)
    await Promise.all([cache.get(record, detect), cache.get(record, detect)])
    expect(detect).toHaveBeenCalledTimes(1)
    expect(cache.peek(record)).toEqual(features)
    expect(cache.peek({ id: 'infra', revision: 2 })).toBeNull()
    now += 10 * 60 * 1000
    expect(cache.peek(record)).toBeNull()
    await cache.get(record, detect)
    expect(detect).toHaveBeenCalledTimes(2)
    cache.forget('infra')
    expect(cache.peek(record)).toBeNull()
  })

  it('does not cache a failed detection', async () => {
    const cache = new FeatureCache()
    await expect(cache.get(record, async () => {
      throw new StudioProblem('target_auth_required')
    })).rejects.toThrow(StudioProblem)
    expect(cache.peek(record)).toBeNull()
  })
})
