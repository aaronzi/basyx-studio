import type { ModelParser } from '../../packages/model-viewer/src/types'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { ifcParser } from '../../packages/model-viewer/src/ifc'
import { useModelViewer } from '../../packages/model-viewer/src/vue'
import { useModelViewer as useViewerCore } from '../../packages/model-viewer/src/vue-core'

// The viewer's life in Vue components: only the latest load changes what
// is shown (packages/model-viewer/src/vue.ts). The renderer is mocked.

/** The parsers each viewer was created with. */
const created: (readonly ModelParser[] | undefined)[] = []

vi.mock('../../packages/model-viewer/src/viewer-core', () => ({
  ModelViewer: class {
    constructor (_container: HTMLElement, options: { parsers?: readonly ModelParser[] }) {
      created.push(options.parsers)
    }

    async load (bytes: Uint8Array, format: string) {
      return { format, triangles: bytes.length, missingImages: [], pickable: false }
    }

    setTheme () {}
    dispose () {}
  },
}))

/** A download the test finishes when it wants to. */
function pending (size: number) {
  let finish!: () => void
  const promise = new Promise<Uint8Array>(resolve => (finish = () => resolve(new Uint8Array(size))))
  return { download: () => promise, finish }
}

const flush = () => new Promise(resolve => setTimeout(resolve, 0))
const theme = () => ({ background: '#000', model: '#888', highlight: '#00f' })

afterEach(() => vi.restoreAllMocks())

describe('useModelViewer', () => {
  it('drops a download that finishes after a later one', async () => {
    // Outside a component, Vue warns about the lifecycle hook.
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const viewer = useModelViewer(ref({} as HTMLElement), theme)
    const first = pending(1)
    const second = pending(2)

    const loads = [viewer.load(first.download, 'stl'), viewer.load(second.download, 'obj')]
    second.finish()
    await flush()
    expect(viewer.result.value?.triangles).toBe(2)

    first.finish()
    await Promise.all(loads)
    expect(viewer.status.value).toBe('ready')
    expect(viewer.result.value).toMatchObject({ format: 'obj', triangles: 2 })
  })

  it('reports only the latest download\'s failure', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const viewer = useModelViewer(ref({} as HTMLElement), theme)
    const second = pending(3)
    const loads = [viewer.load(() => new Promise((_, reject) => setTimeout(() => reject(new Error('gone')), 5)), 'stl'), viewer.load(second.download, 'stl')]
    second.finish()
    await Promise.all(loads)
    expect(viewer.problem.value).toBeNull()
    expect(viewer.result.value?.triangles).toBe(3)
  })
})

describe('the parsers of the viewer', () => {
  it('are all formats\' in /vue, and those the app registers in /vue/core', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    created.length = 0
    await useModelViewer(ref({} as HTMLElement), theme).load(async () => new Uint8Array(1), 'stl')
    await useViewerCore(ref({} as HTMLElement), theme, { parsers: [ifcParser] }).load(async () => new Uint8Array(1), 'stl')
    await useViewerCore(ref({} as HTMLElement), theme).load(async () => new Uint8Array(1), 'stl')
    expect(created.map(parsers => parsers?.map(parser => parser.format))).toEqual([['ifc', 'step'], ['ifc'], undefined])
  })
})
