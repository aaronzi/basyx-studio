import type { ElementNode, SubmodelRef, SubmodelTree, TreeNode } from '#shared/contract'
import { StudioApiError } from '~/composables/useStudioApi'

/** One entry of the shell's tree: a submodel or an element below it. */
export interface ShellTreeItem {
  /** `submodelKey` for submodels, `submodelKey/elementKey` for elements. */
  id: string
  title: string
  modelType: string
  submodelKey: string
  elementKey: string | null
  semanticId: string | null
  preview: string | null
  valueType: string | null
  variableGroup: ElementNode['variableGroup']
  /** A submodel that cannot be shown (no access, missing, or absent at the chosen time). */
  unavailable: 'forbidden' | 'not_found' | 'blocked' | 'error' | 'absent' | null
  /** Has numeric properties whose values are re-read. */
  refreshable: boolean
  children?: ShellTreeItem[]
}

interface TreeState {
  tree: SubmodelTree | null
  error: unknown
  loading: boolean
}

const numericTypes = new Set(['xs:double', 'xs:float', 'xs:decimal', 'xs:int', 'xs:integer', 'xs:long', 'xs:short', 'xs:byte',
  'xs:unsignedInt', 'xs:unsignedLong', 'xs:unsignedShort', 'xs:unsignedByte', 'xs:positiveInteger', 'xs:negativeInteger',
  'xs:nonNegativeInteger', 'xs:nonPositiveInteger'])
const historyLength = 30
const concurrency = 4

export function itemId (submodelKey: string, elementKey: string | null): string {
  return elementKey ? `${submodelKey}/${elementKey}` : submodelKey
}

function isNumeric (node: Pick<TreeNode, 'modelType' | 'valueType'>): boolean {
  return node.modelType === 'Property' && numericTypes.has(node.valueType ?? '')
}

/**
 * The element trees of all submodels of a shell, loaded completely (plan D5)
 * and re-read on an interval while the page is visible. Re-reading keeps a
 * short history of numeric values for this session; the server stores none.
 * With `at`, the trees show the submodels as they were at that time.
 */
export function useShellTrees (options: {
  targetId: () => string
  refs: () => SubmodelRef[]
  at: () => string | null
  /** Seconds between re-reads, or `null` to stop. */
  refreshSeconds: () => number | null
}) {
  const api = useStudioApi()
  const states = ref<Record<string, TreeState>>({})
  /** Children loaded on demand below nodes of truncated (too large) trees. */
  const lazy = ref<Record<string, ElementNode[]>>({})
  const history = shallowRef(new Map<string, number[]>())
  let generation = 0

  function treeUrl (submodelKey: string) {
    return `/targets/${options.targetId()}/submodels/${submodelKey}/tree`
  }

  function record (submodelKey: string, nodes: TreeNode[]) {
    const next = new Map(history.value)
    const visit = (items: TreeNode[]) => {
      for (const node of items) {
        if (isNumeric(node) && node.preview !== null && Number.isFinite(Number(node.preview))) {
          const id = itemId(submodelKey, node.key)
          next.set(id, [...(next.get(id) ?? []), Number(node.preview)].slice(-historyLength))
        }
        visit(node.children ?? [])
      }
    }
    visit(nodes)
    history.value = next
  }

  async function fetchTree (submodelKey: string, current: number, quiet: boolean) {
    if (!quiet) {
      states.value = { ...states.value, [submodelKey]: { tree: states.value[submodelKey]?.tree ?? null, error: null, loading: true } }
    }
    try {
      const at = options.at()
      const tree = await api<SubmodelTree>(treeUrl(submodelKey), { query: { at: at ?? undefined } })
      if (current === generation) {
        states.value = { ...states.value, [submodelKey]: { tree, error: null, loading: false } }
        if (!at) {
          record(submodelKey, tree.root)
        }
      }
    } catch (error) {
      if (current === generation && !quiet) {
        states.value = { ...states.value, [submodelKey]: { tree: null, error, loading: false } }
      }
    }
  }

  async function loadAll (quiet = false) {
    const current = quiet ? generation : ++generation
    if (!quiet) {
      states.value = {}
      lazy.value = {}
    }
    const keys = options.refs().filter(ref => ref.status === 'available').map(ref => ref.key)
    let next = 0
    const worker = async () => {
      while (next < keys.length) {
        await fetchTree(keys[next++]!, current, quiet)
      }
    }
    await Promise.all(Array.from({ length: Math.min(concurrency, keys.length) }, () => worker()))
  }

  /** Loads one submodel (when it is opened before the bulk load reached it). */
  async function ensure (submodelKey: string) {
    if (!states.value[submodelKey]?.tree && !states.value[submodelKey]?.loading) {
      await fetchTree(submodelKey, generation, false)
    }
  }

  async function loadChildren (submodelKey: string, elementKey: string) {
    const current = generation
    const result = await api<{ items: ElementNode[] }>(`/targets/${options.targetId()}/submodels/${submodelKey}/elements`, { query: { parentElementKey: elementKey } })
    if (current === generation) {
      lazy.value = { ...lazy.value, [itemId(submodelKey, elementKey)]: result.items }
    }
  }

  function toItem (submodelKey: string, node: TreeNode | ElementNode, truncated: boolean): ShellTreeItem {
    const id = itemId(submodelKey, node.key)
    const children = 'children' in node && node.children
      ? node.children.map(child => toItem(submodelKey, child, truncated))
      : (node.hasChildren ? (lazy.value[id]?.map(child => toItem(submodelKey, child, truncated)) ?? []) : undefined)
    return {
      id,
      title: node.label,
      modelType: node.modelType,
      submodelKey,
      elementKey: node.key,
      semanticId: node.semanticId,
      preview: node.preview,
      valueType: 'valueType' in node ? node.valueType : null,
      variableGroup: node.variableGroup,
      unavailable: null,
      refreshable: false,
      children,
    }
  }

  function hasNumeric (nodes: TreeNode[]): boolean {
    return nodes.some(node => isNumeric(node) || hasNumeric(node.children ?? []))
  }

  const items = computed<ShellTreeItem[]>(() => options.refs().map(ref => {
    const state = states.value[ref.key]
    const absent = options.at() !== null && state?.error instanceof StudioApiError && state.error.code === 'target_resource_not_found'
    let unavailable: ShellTreeItem['unavailable'] = ref.status === 'available' ? null : ref.status
    if (absent) {
      unavailable = 'absent'
    } else if (!unavailable && state?.error) {
      unavailable = 'error'
    }
    const tree = state?.tree
    return {
      id: ref.key,
      title: ref.idShort ?? tree?.idShort ?? ref.submodelId,
      modelType: 'Submodel',
      submodelKey: ref.key,
      elementKey: null,
      semanticId: ref.semanticId,
      preview: null,
      valueType: null,
      variableGroup: null,
      unavailable,
      refreshable: tree ? hasNumeric(tree.root) : false,
      // An empty list lets the tree ask for the children when it is opened.
      children: unavailable ? undefined : (tree ? tree.root.map(node => toItem(ref.key, node, tree.truncated)) : []),
    }
  }))

  /** Ids of every item with children, for "expand all". */
  const expandableIds = computed(() => {
    const ids: string[] = []
    const visit = (list: ShellTreeItem[]) => {
      for (const item of list) {
        if (item.children && item.children.length > 0) {
          ids.push(item.id)
          visit(item.children)
        }
      }
    }
    visit(items.value)
    return ids
  })

  const loading = computed(() => Object.values(states.value).some(state => state.loading))

  watch(() => [options.targetId(), options.refs().map(ref => ref.key).join(','), options.at()], () => void loadAll(), { immediate: true })

  if (import.meta.client) {
    let timer: ReturnType<typeof setInterval> | undefined
    watch(() => [options.refreshSeconds(), options.at()] as const, ([seconds, at]) => {
      clearInterval(timer)
      if (seconds && !at) {
        timer = setInterval(() => {
          if (document.visibilityState === 'visible') {
            void loadAll(true)
          }
        }, seconds * 1000)
      }
    }, { immediate: true })
    onScopeDispose(() => clearInterval(timer))
  }

  /** Re-reads one submodel without a loading state, e.g. after a value was changed. */
  function refresh (submodelKey: string) {
    return fetchTree(submodelKey, generation, true)
  }

  return { items, states, history, expandableIds, loading, ensure, loadChildren, refresh, reload: () => loadAll() }
}
