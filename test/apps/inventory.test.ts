import type { ShellSummary } from '@basyx/studio-sdk'
import { createStudioHistory } from '@basyx/studio-app-kit/router'
import { createTestStudio, memoryAas } from '@basyx/studio-sdk/testing'
import { afterEach, describe, expect, it, vi } from 'vitest'
import manifest from '../../examples/apps/inventory/studio-app.json'
import { countShells, ifcModels, loadShells, shellIdOf, shellKey } from '../../examples/apps/inventory/ui/src/inventory'
import { createAppRouter } from '../../examples/apps/inventory/ui/src/router'

// The example of a full-page module with pages (external apps follow-up
// plan N3): its router on the app kit's history over the module's
// sub-path, and the test Studio built from its manifest (W1).

const flush = () => new Promise(resolve => setTimeout(resolve, 0))
const page = { render: () => null }
const pages = { overview: page, shells: page, shell: page }

function shell (index: number, assetKind = 'Instance'): ShellSummary {
  return { id: `https://example.com/ids/aas/${index}`, idShort: `Shell${index}`, displayName: [], assetKind, globalAssetId: null }
}

/** A test Studio of the example, its router started as `app.use(router)` starts it. */
async function started (subPath = '') {
  const studio = createTestStudio({ manifest, context: { subPath } })
  const router = createAppRouter(studio.client, pages)
  await router.push(router.options.history.location)
  return { studio, router }
}

afterEach(() => vi.restoreAllMocks())

describe('the test Studio of the manifest', () => {
  it('names the app and its module, and refuses what the manifest does not declare', async () => {
    const studio = createTestStudio({ manifest })
    expect(studio.context.appId).toBe('org.eclipse.basyx.examples.inventory')
    expect(studio.context.contribution).toEqual({ kind: 'module', id: 'inventory' })
    await expect(studio.client.ui.copyText('x')).rejects.toMatchObject({ code: 'app_permission_not_declared' })
  })
})

describe('the router on the module\'s sub-path', () => {
  it('starts on the page of Studio\'s sub-path', async () => {
    const key = shellKey('https://example.com/ids/aas/1')
    const { router } = await started(`shells/${key}`)
    expect(router.currentRoute.value.name).toBe('shell')
    expect(router.currentRoute.value.params.shell).toBe(key)
  })

  it('moves Studio\'s sub-path with the route, without echoing it back', async () => {
    const { studio, router } = await started()
    const listener = vi.fn()
    router.options.history.listen(listener)
    await router.push({ name: 'shells' })
    await router.push({ name: 'shell', params: { shell: 'abc' } })
    await flush()
    expect(studio.context.subPath).toBe('shells/abc')
    expect(studio.navigations).toEqual([{ subPath: 'shells', history: 'push' }, { subPath: 'shells/abc', history: 'push' }])
    expect(listener).not.toHaveBeenCalled()
  })

  it('follows the browser\'s back and forward buttons through the pushed pages', async () => {
    const { studio, router } = await started()
    await router.push({ name: 'shells' })
    await router.push({ name: 'shell', params: { shell: 'abc' } })
    await flush()
    expect(studio.back()).toBe(true)
    await flush()
    expect(router.currentRoute.value.name).toBe('shells')
    expect(studio.back()).toBe(true)
    await flush()
    expect(router.currentRoute.value.name).toBe('overview')
    expect(studio.forward()).toBe(true)
    await flush()
    expect(router.currentRoute.value.name).toBe('shells')
    // The browser moved; nothing is sent back to Studio.
    expect(studio.navigations).toHaveLength(2)
  })

  it('follows a sub-path Studio changes', async () => {
    const { studio, router } = await started()
    studio.setContext({ subPath: 'shells' })
    await flush()
    expect(router.currentRoute.value.name).toBe('shells')
  })

  it('goes back through the module\'s pages, and Studio follows', async () => {
    const { studio, router } = await started()
    await router.push({ name: 'shells' })
    await router.push({ name: 'shell', params: { shell: 'abc' } })
    router.back()
    await flush()
    expect(router.currentRoute.value.name).toBe('shells')
    expect(studio.context.subPath).toBe('shells')
    router.forward()
    await flush()
    expect(router.currentRoute.value.fullPath).toBe('/shells/abc')
    expect(studio.context.subPath).toBe('shells/abc')
  })

  it('redirects an unknown sub-path to the overview', async () => {
    const { router, studio } = await started('nothing/here')
    await flush()
    expect(router.currentRoute.value.name).toBe('overview')
    expect(studio.context.subPath).toBe('')
  })
})

describe('createStudioHistory', () => {
  it('replaces Studio\'s entry unless pushing is switched on, so older Studios take the call', async () => {
    const studio = createTestStudio({ manifest })
    const history = createStudioHistory(studio.client)
    history.push('/a')
    await flush()
    expect(studio.calls.at(-1)?.params).toEqual({ subPath: 'a' })
    const pushing = createStudioHistory(studio.client, { history: 'push' })
    pushing.push('/b')
    pushing.replace('/c')
    await flush()
    expect(studio.navigations.slice(1)).toEqual([{ subPath: 'b', history: 'push' }, { subPath: 'c', history: 'replace' }])
  })

  it('sends one move at a time, and only the latest page of rapid moves', async () => {
    const studio = createTestStudio({ manifest })
    const history = createStudioHistory(studio.client, { history: 'push' })
    const listener = vi.fn()
    history.listen(listener)
    for (const location of ['/a', '/b?view=list#top', '/c', '/b']) {
      history.push(location)
    }
    await flush()
    expect(history.location).toBe('/b')
    expect(studio.context.subPath).toBe('b')
    expect(studio.navigations).toEqual([{ subPath: 'a', history: 'push' }, { subPath: 'b', history: 'push' }])
    expect(listener).not.toHaveBeenCalled()
  })

  /** A Studio whose router, like Studio's, sends the context only for the move that is not overtaken. */
  function coalescingStudio () {
    let navigation: ReturnType<typeof setTimeout> | undefined
    return createTestStudio({
      manifest,
      handlers: {
        'studio.ui.navigate': ({ subPath }, studio) => {
          clearTimeout(navigation)
          navigation = setTimeout(() => studio.setContext({ subPath }), 5)
          return null
        },
      },
    })
  }

  it('follows Studio after rapid moves back to where they started (A → B → A)', async () => {
    const studio = coalescingStudio()
    const history = createStudioHistory(studio.client)
    const listener = vi.fn()
    history.listen(listener)
    for (const location of ['/a', '/b', '/a']) {
      history.push(location)
    }
    await new Promise(resolve => setTimeout(resolve, 20))
    expect([history.location, studio.context.subPath]).toEqual(['/a', 'a'])
    expect(listener).not.toHaveBeenCalled()
    // A later move of Studio's own is not taken for an answer to the router.
    studio.setContext({ subPath: 'b' })
    expect(history.location).toBe('/b')
    expect(listener).toHaveBeenCalledOnce()
  })

  it('lets Studio\'s own move win over a pending one', async () => {
    const studio = coalescingStudio()
    const history = createStudioHistory(studio.client)
    for (const location of ['/a', '/b']) {
      history.push(location)
    }
    studio.setContext({ subPath: 'c' })
    expect(history.location).toBe('/c')
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(studio.calls.filter(call => call.method === 'studio.ui.navigate')).toHaveLength(1)
  })

  it('goes on when Studio takes a move but its context never comes', async () => {
    vi.useFakeTimers()
    try {
      const studio = createTestStudio({ manifest, handlers: { 'studio.ui.navigate': () => null } })
      const history = createStudioHistory(studio.client)
      for (const location of ['/a', '/b']) {
        history.push(location)
      }
      await vi.advanceTimersByTimeAsync(0)
      expect(studio.calls.map(call => call.params)).toEqual([{ subPath: 'a' }])
      await vi.advanceTimersByTimeAsync(2000)
      expect(studio.calls.map(call => call.params)).toEqual([{ subPath: 'a' }, { subPath: 'b' }])
    } finally {
      vi.useRealTimers()
    }
  })

  it('tells the router where Studio moved: back, forward or to a new page', async () => {
    const studio = createTestStudio({ manifest })
    const history = createStudioHistory(studio.client)
    for (const location of ['/a', '/b']) {
      history.push(location)
    }
    await flush()
    const moves: unknown[] = []
    history.listen((to, from, information) => moves.push([to, from, information.delta, information.direction]))
    studio.setContext({ subPath: 'a' })
    studio.setContext({ subPath: 'b' })
    studio.setContext({ subPath: 'c' })
    expect(moves).toEqual([['/a', '/b', -1, 'back'], ['/b', '/a', 1, 'forward'], ['/c', '/b', 0, '']])
  })

  it('reports a sub-path Studio refuses', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const studio = createTestStudio({ manifest, permissions: ['studio.aas.read'] })
    createStudioHistory(studio.client).push('/a')
    await flush()
    expect(error).toHaveBeenCalledWith('Studio refused the sub-path "a":', expect.objectContaining({ code: 'app_permission_not_declared' }))
  })
})

describe('the pages\' data', () => {
  it('reads every page of shells, up to the limit', async () => {
    const shells = Array.from({ length: 250 }, (_, index) => shell(index, index % 5 === 0 ? 'Type' : 'Instance'))
    const studio = createTestStudio({
      manifest,
      handlers: {
        'studio.aas.listShells': ({ limit = 100, cursor }) => {
          const start = Number(cursor ?? 0)
          const end = start + limit
          return { items: shells.slice(start, end), page: { nextCursor: end < shells.length ? String(end) : null, hasMore: end < shells.length } }
        },
      },
    })
    const { shells: loaded, complete } = await loadShells(studio.client)
    expect(complete).toBe(true)
    expect(countShells(loaded)).toEqual({ shells: 250, instances: 200, types: 50 })
  })

  it('carries any shell ID in a route segment', () => {
    const id = 'urn:example:aas:Ümlaut/1?x=1'
    expect(shellKey(id)).toMatch(/^[\w-]+$/)
    expect(shellIdOf(shellKey(id))).toBe(id)
    expect(shellIdOf('not base64!')).toBeNull()
  })

  it('finds the IFC models of a submodel', async () => {
    const aas = memoryAas({
      submodels: [{
        modelType: 'Submodel',
        id: 'urn:example:sm:models',
        idShort: 'Models',
        submodelElements: [
          { modelType: 'SubmodelElementCollection', idShort: 'Building', value: [{ modelType: 'File', idShort: 'Model', contentType: 'application/x-step', value: '/aasx/files/hall.ifc' }] },
          { modelType: 'File', idShort: 'Part', contentType: 'model/step', value: 'part.step' },
        ],
      }],
    })
    const studio = createTestStudio({ manifest, handlers: aas.handlers })
    expect(ifcModels(await studio.client.aas.getSubmodel('urn:example:sm:models'))).toEqual([{ path: 'Building.Model', fileName: 'hall.ifc' }])
  })
})
