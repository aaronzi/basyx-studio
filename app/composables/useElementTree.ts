import type { ElementModelType } from '#shared/aas/defaults'
import type { EffectiveRights, ElementDetail, SubmodelRef, Target, TargetCapabilities } from '#shared/contract'
import type { ComputedRef, InjectionKey } from 'vue'
import type { ClipboardCommand } from '~/composables/useClipboardCommands'
import type { LiveSignal } from '~/composables/useShellOverview'
import type { ShellTreeItem } from '~/composables/useShellTrees'
import type { StructureAction } from '~/stores/structureActions'
import type { DetailsMode } from '~/utils/aas'
import type { CreatingElement } from '~/utils/editor'
import { useQueryCache } from '@pinia/colada'
import { childTypesFor, isContainerType, newElement, uniqueIdShort } from '#shared/aas/defaults'
import { semanticLabel } from '#shared/aas/semantic-label'
import { noCapabilities } from '#shared/contract'
import { expandAllCap, itemId } from '~/composables/useShellTrees'
import { StudioApiError } from '~/composables/useStudioApi'
import { decodeResourceKey, detailsModes } from '~/utils/aas'

/** Live value cards on the Overview, so a large submodel cannot fill it. */
const liveSignalLimit = 8
const draftSuffix = '#draft'

export interface ElementTreeOptions {
  targetId: () => string
  target: () => Target | undefined
  /** The submodels the tree shows: a shell's references, or the one submodel of the submodel view. */
  refs: () => SubmodelRef[]
  /** The user's rights where the target shares access (D15); without sharing, everything is allowed. */
  can: (action: keyof EffectiveRights) => boolean
  /** Something beyond the tree changed (a conversion, undo or redo): the page reads its resources again. */
  onResourcesChanged: () => Promise<void>
  /** Runs before a selection changes, e.g. to close a form that took the details drawer. */
  beforeSelect?: () => void
  /**
   * The submodel the page is about (the submodel view): the list chooses it,
   * the tree only what the details drawer shows. Deselecting in the tree
   * closes the drawer and keeps the submodel, its row is selected only while
   * the drawer shows it, and a link that names no element opens no drawer.
   */
  subject?: () => string | null
}

/**
 * The element tree of the shell page and the submodel view: the trees of
 * the submodels (useShellTrees), the selection and the details drawer's mode
 * in the URL (`submodel`, `element`, `mode`, `view`), a point in time, and
 * the structure actions of edit mode (MVP-5 plan, U3, U4, U6, C1) with their
 * capability gates. The page provides it (`provideElementTree`) for the tree
 * card and passes its parts to the details drawer.
 */
export function useElementTree (options: ElementTreeOptions) {
  const { t, locale } = useI18n()
  const route = useRoute()
  const router = useRouter()
  const api = useStudioApi()
  const queryCache = useQueryCache()
  const ui = useUiStore()
  const copy = useClipboard()
  const preferences = usePreferences()
  const notifications = useNotificationsStore()

  const targetId = computed(() => options.targetId())
  const capabilities = computed<TargetCapabilities>(() => options.target()?.capabilities ?? noCapabilities)
  const submodelRefs = computed(() => options.refs())

  // In view mode nothing can be changed (plan D8); with sharing, the user's rights decide (D15).
  const asOf = ref<Date | null>(null)
  const canWrite = computed(() => ui.editing && capabilities.value.write && options.can('update') && !asOf.value)
  // Structure actions need the target to accept structural writes (MVP-5 plan, P1).
  const canCreate = computed(() => ui.editing && capabilities.value.createResources && options.can('update') && !asOf.value)
  const canEditStructure = computed(() => ui.editing && capabilities.value.writeStructure && options.can('update') && !asOf.value)
  const canInvoke = computed(() => capabilities.value.operations && options.can('execute') && !asOf.value)

  // Point in time: the end of the chosen day, or now for today.
  const historyMenu = ref(false)
  const asOfIso = computed(() => {
    if (!asOf.value) {
      return null
    }
    const end = new Date(asOf.value)
    end.setHours(23, 59, 59, 999)
    return (end > new Date() ? new Date() : end).toISOString()
  })
  const asOfLabel = computed(() => asOf.value?.toLocaleDateString(locale.value, { day: 'numeric', month: 'short', year: 'numeric' }) ?? '')
  function pickDate (value: unknown) {
    asOf.value = value instanceof Date ? value : null
    historyMenu.value = false
  }

  const autoRefresh = computed(() => preferences.preferences.value.autoRefresh)
  const refreshSeconds = computed(() => preferences.preferences.value.autoRefresh && !asOf.value ? preferences.preferences.value.refreshIntervalSeconds : null)
  function toggleAutoRefresh () {
    void preferences.update(current => ({ ...current, autoRefresh: !current.autoRefresh }))
  }
  // The submodels and elements open in the tree: none until the user opens one.
  const opened = ref<string[]>([])
  const treeSearch = ref<string | null>('')
  const trees = useShellTrees({
    targetId: () => targetId.value,
    refs: () => submodelRefs.value,
    at: () => asOfIso.value,
    refreshSeconds: () => refreshSeconds.value,
    opened: () => opened.value,
    unpaged: () => Boolean(treeSearch.value),
  })
  // Units of linked concept descriptions, shown beside values in the tree and on the Overview (MVP-6 plan, E6).
  const unitOf = useConceptUnits(targetId, () => capabilities.value.conceptDescriptions)

  // The Overview's live values: numeric properties whose value changed while auto-refresh re-read them.
  const liveSignals = computed<LiveSignal[]>(() => {
    if (!refreshSeconds.value) {
      return []
    }
    const signals: LiveSignal[] = []
    for (const [id, values] of trees.history.value) {
      const item = new Set(values).size > 1 ? trees.lookup(id) : null
      if (item) {
        const submodel = trees.items.value.find(entry => entry.id === item.submodelKey)?.title ?? item.submodelKey
        signals.push({ id, submodelKey: item.submodelKey, elementKey: item.elementKey!, title: item.title, submodel, value: item.preview, unit: unitOf(item.semanticId), history: values })
      }
    }
    return signals.slice(0, liveSignalLimit)
  })

  // Structure editing (MVP-5 plan, U3, U4, U6, C1)
  const clipboardStore = useClipboardStore()
  const copies = useCopyActions()
  const drafts = useDraftStore()
  const structure = useStructureEdits(() => targetId.value)
  const creating = ref<CreatingElement | null>(null)

  const treeItems = computed(() => {
    const items = trees.items.value.map(item => item.unavailable ? { ...item, disabled: true } : item)
    const draft = creating.value
    if (!draft) {
      return items
    }
    // The element being created is a row of its own, marked as a draft (U4).
    const parentId = draft.parentKey ? itemId(draft.submodelKey, draft.parentKey) : draft.submodelKey
    const row: ShellTreeItem = {
      id: `${parentId}${draftSuffix}`,
      title: String(draft.element.idShort ?? draft.element.modelType),
      modelType: String(draft.element.modelType),
      submodelKey: draft.submodelKey,
      elementKey: null,
      semanticId: null,
      preview: null,
      valueType: null,
      variableGroup: null,
      unavailable: null,
      refreshable: false,
      draft: true,
    }
    const insert = (list: ShellTreeItem[]): ShellTreeItem[] => list.map(item => item.id === parentId
      ? { ...item, children: [...(item.children ?? []), row] }
      : (item.children ? { ...item, children: insert(item.children) } : item))
    return insert(items)
  })

  async function loadChildren (raw: unknown) {
    await trees.loadChildren(raw as ShellTreeItem)
  }

  // Expands the opened submodels (or all, if none is open) as far as the cap allows.
  const expanding = ref(false)
  async function expandAll () {
    expanding.value = true
    try {
      const openSubmodels = trees.items.value.filter(item => opened.value.includes(item.id)).map(item => item.id)
      const { ids, capped } = await trees.expandAll(openSubmodels.length > 0 ? openSubmodels : trees.items.value.map(item => item.id))
      opened.value = [...new Set([...opened.value, ...ids])]
      if (capped) {
        notifications.notify({ text: t('shell.expandCapped', { count: expandAllCap.toLocaleString(locale.value) }), color: 'info' })
      }
    } finally {
      expanding.value = false
    }
  }

  function collapseAll () {
    opened.value = []
  }

  /** The template and version of a submodel for its chip, from its semantic ID and administration. */
  function templateLabel (item: ShellTreeItem): string | null {
    const ref = submodelRefs.value.find(entry => entry.key === item.submodelKey)
    return item.semanticId ? semanticLabel(item.semanticId, item.title, ref?.administration) : null
  }

  // Selection lives in the URL (`submodel`, `element`), so it can be shared and survives reloads.
  const selectedId = computed(() => {
    const submodel = typeof route.query.submodel === 'string' ? route.query.submodel : null
    const element = typeof route.query.element === 'string' ? route.query.element : null
    return submodel ? itemId(submodel, element) : null
  })

  const selectedItem = computed(() => selectedId.value ? trees.lookup(selectedId.value) : null)
  const selectedSubmodelLabel = computed(() => trees.items.value.find(item => item.id === selectedItem.value?.submodelKey)?.title ?? null)
  const selectedRef = computed(() => submodelRefs.value.find(ref => ref.key === selectedItem.value?.submodelKey) ?? null)
  const selectedHistory = computed(() => selectedItem.value ? (trees.history.value.get(selectedItem.value.id) ?? []) : [])

  // The drawer's mode and app view (R3); a `view` alone (MVP-3 links) opens the visualization.
  const detailsMode = computed<DetailsMode>({
    get: () => {
      const value = route.query.mode
      if (typeof value === 'string' && (detailsModes as readonly string[]).includes(value)) {
        return value as DetailsMode
      }
      return typeof route.query.view === 'string' ? 'visualization' : 'details'
    },
    set: (value: DetailsMode) => router.replace({ query: { ...route.query, mode: value === 'details' ? undefined : value, view: value === 'visualization' ? route.query.view : undefined } }),
  })
  const detailsView = computed<string | null>({
    get: () => (typeof route.query.view === 'string' ? route.query.view : null),
    set: (value: string | null) => router.replace({ query: { ...route.query, view: value ?? undefined } }),
  })

  function select (id: string | null) {
    const found = id ? trees.lookup(id) : null
    if (found?.more) {
      trees.showMore(found.more.parent)
      return
    }
    // A new element's draft stays in the draft store; the form closes.
    if (id?.endsWith(draftSuffix)) {
      return
    }
    creating.value = null
    options.beforeSelect?.()
    // The page's own submodel stays when nothing is selected.
    const submodel = found?.submodelKey ?? options.subject?.() ?? undefined
    void router.replace({ query: { ...route.query, submodel, element: found?.elementKey ?? undefined } })
    ui.detailsDrawer = Boolean(found)
  }

  /** Opens an element or submodel of the Overview in the drawer; `inTree` also shows it in the tree (the path is revealed below). */
  function openFromOverview (submodelKey: string, elementKey: string | null, inTree: boolean) {
    creating.value = null
    options.beforeSelect?.()
    void router.replace({ query: { ...route.query, tab: inTree ? undefined : route.query.tab, submodel: submodelKey, element: elementKey ?? undefined } })
    ui.detailsDrawer = true
  }

  /**
   * The drawer belongs to the tree's tab (`home`): other tabs close it, and
   * the Overview opens it only from a tile. Back on the tree's tab it is
   * open again if it was when the user left, or if a tile opened it.
   */
  function followTabs (tab: () => string, home: string) {
    let openAtHome = ui.detailsDrawer
    watch(tab, (value, previous) => {
      const open = ui.detailsDrawer
      if (previous === home) {
        openAtHome = open
      }
      ui.detailsDrawer = value === home && (openAtHome || open)
    })
  }

  // The page's own submodel is the tree's selection only while the drawer shows it.
  const activated = computed({
    get: () => {
      const subjectOnly = options.subject && selectedId.value === options.subject() && !ui.detailsDrawer
      return selectedId.value && !subjectOnly ? [selectedId.value] : []
    },
    set: (ids: unknown[]) => select((ids[0] as string | undefined) ?? null),
  })

  /** Element keys of the loaded items above an item. */
  function trail (id: string): string[] {
    const walk = (list: ShellTreeItem[], path: string[]): string[] | null => {
      for (const item of list) {
        if (item.id === id) {
          return path
        }
        const found = walk(item.children ?? [], item.elementKey ? [...path, item.elementKey] : path)
        if (found) {
          return found
        }
      }
      return null
    }
    return walk(trees.items.value, []) ?? []
  }

  // A selection made elsewhere (deep link, search): load and open its path,
  // which the element's ancestors name.
  const revealing = ref<string | null>(null)
  const opensDetails = (element: string | null) => element !== null || !options.subject
  watch([selectedId, () => submodelRefs.value.length, asOfIso], async ([id]) => {
    const submodel = typeof route.query.submodel === 'string' ? route.query.submodel : null
    const element = typeof route.query.element === 'string' ? route.query.element : null
    if (!id || !submodel || revealing.value === id || !submodelRefs.value.some(ref => ref.key === submodel && ref.status === 'available')) {
      return
    }
    revealing.value = id
    try {
      let ancestors: string[] = []
      if (element && !trees.lookup(id)) {
        const detail = await api<ElementDetail>(`/targets/${targetId.value}/submodels/${submodel}/elements/${element}`, { query: { at: asOfIso.value ?? undefined } })
        ancestors = detail.ancestors.map(ancestor => ancestor.key)
      } else if (element) {
        ancestors = trail(id)
      }
      const path = await trees.reveal(submodel, ancestors, element)
      if (path && selectedId.value === id) {
        opened.value = [...new Set([...opened.value, ...path])]
        ui.detailsDrawer ||= opensDetails(element)
      }
    } catch {
      // The drawer shows why the element cannot be read.
      ui.detailsDrawer ||= opensDetails(element)
    } finally {
      revealing.value = null
    }
  }, { immediate: true })

  /** Another shell or submodel: no point in time, nothing open. */
  function resetView () {
    asOf.value = null
    opened.value = []
  }

  async function onElementChanged (detail: ElementDetail) {
    const item = selectedItem.value
    if (item) {
      await trees.refresh(item.submodelKey)
    }
    // A workspace now has unsaved changes.
    await queryCache.invalidateQueries({ key: ['targets', targetId.value], exact: true })
    // A rename or move gives the element a new path: the selection and URL follow (W3).
    if (item?.elementKey && detail.key !== item.elementKey) {
      select(itemId(item.submodelKey, detail.key))
    }
  }

  const rowMenuOpen = ref(false)
  const rowMenuActivator = ref<HTMLElement | null>(null)
  // A snapshot of the row: refreshes of the tree do not rebuild the open menu.
  const menuItem = ref<ShellTreeItem | null>(null)

  /** Choosing an action closes the menu; opening the type group does not. */
  function closeRowMenu (event: MouseEvent) {
    if (!(event.target as HTMLElement).closest('.v-list-group__header')) {
      rowMenuOpen.value = false
    }
  }

  function openRowMenu (event: MouseEvent, item: ShellTreeItem) {
    menuItem.value = item
    rowMenuActivator.value = event.currentTarget as HTMLElement
    rowMenuOpen.value = true
  }
  const jsonTarget = ref<ShellTreeItem | null>(null)
  const convertTarget = ref<ShellTreeItem | null>(null)
  const converting = ref(false)
  const pendingDelete = ref<ShellTreeItem | null>(null)
  const removing = ref(false)
  const actionError = ref<unknown>(null)

  const hasDraft = (item: ShellTreeItem) => !item.more && !item.draft && drafts.has(targetId.value, item.submodelKey, item.elementKey ?? 'submodel')
  const isContainerItem = (item: ShellTreeItem) => item.modelType === 'Submodel' || isContainerType(item.modelType)
  function hasActions (item: ShellTreeItem) {
    return !item.more && !item.unavailable && !item.variableGroup && item.modelType !== 'OperationVariables'
      && (item.modelType === 'Submodel' ? isContainerItem(item) : !item.elementKey?.includes('@'))
  }
  const addableTypes = (item: ShellTreeItem) => childTypesFor(item.modelType === 'Submodel' ? null : { modelType: item.modelType })

  const siblings = (item: ShellTreeItem) => (trees.parentOf(item.id)?.children ?? []).filter(child => !child.more)
  // Named children keep an order only where the target stores one; list items always do.
  const canMove = (item: ShellTreeItem) => capabilities.value.orderedChildren || (decodeResourceKey(item.elementKey ?? '') ?? '').endsWith(']')
  const position = (item: ShellTreeItem) => siblings(item).findIndex(child => child.id === item.id)
  const siblingCount = (item: ShellTreeItem) => siblings(item).length

  /** The revision of the children of a container, loading its level first. */
  async function structureRevisionOf (item: Pick<ShellTreeItem, 'id' | 'submodelKey' | 'elementKey'>): Promise<string> {
    await trees.loadChildren(item)
    const revision = trees.structureRevision(item.id)
    if (!revision) {
      throw new StudioApiError({ type: 'about:blank', title: 'The structure is not known yet', status: 412, code: 'structure_conflict', requestId: '', retryable: true })
    }
    return revision
  }

  async function guard (work: () => Promise<void>) {
    actionError.value = null
    try {
      await work()
    } catch (error) {
      actionError.value = error
      // A conflict means the tree is out of date.
      if (error instanceof StudioApiError && ['structure_conflict', 'revision_conflict'].includes(error.code) && selectedItem.value) {
        await trees.refresh(selectedItem.value.submodelKey)
      }
    }
  }

  async function insertJson (value: Record<string, unknown>) {
    const parent = jsonTarget.value!
    const revision = await structureRevisionOf(parent)
    const names = (parent.children ?? []).filter(child => !child.more).map(child => child.title)
    const added = await structure.paste(parent.submodelKey, parent.elementKey, revision, value, names, parent.modelType === 'SubmodelElementList')
    opened.value = [...new Set([...opened.value, parent.id])]
    await afterStructureChange(parent.submodelKey)
    select(itemId(parent.submodelKey, added.key))
  }

  async function convertToInstance () {
    const item = convertTarget.value
    if (!item) {
      return
    }
    converting.value = true
    await guard(async () => {
      const result = await api<{ removedQualifiers: number }>(`/targets/${targetId.value}/submodels/${item.submodelKey}/instance-conversions`, { method: 'POST' })
      notifications.notify({ text: t('edit.converted', { name: item.title, count: result.removedQualifiers }), color: 'success' })
      await options.onResourcesChanged()
    })
    converting.value = false
    convertTarget.value = null
  }

  // ⌘Z and ⇧⌘Z undo and redo on workspaces, until Save or Close (W8); live
  // targets have no undo, and text fields keep their own.
  const workspaceId = computed(() => options.target()?.workspace ? targetId.value : null)
  function onKeydown (event: KeyboardEvent) {
    if (!ui.editing || !workspaceId.value || !capabilities.value.undo || !(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'z') {
      return
    }
    const active = event.target as HTMLElement | null
    if (active?.closest('input, textarea, [contenteditable="true"], .monaco-editor')) {
      return
    }
    event.preventDefault()
    const workspace = options.target()?.workspace
    const kind = event.shiftKey ? 'redos' : 'undos'
    if ((kind === 'undos' && !workspace?.canUndo) || (kind === 'redos' && !workspace?.canRedo)) {
      return
    }
    void guard(async () => {
      const updated = await api<Target>(`/workspaces/${workspaceId.value}/${kind}`, { method: 'POST' })
      queryCache.setQueryData(['targets', updated.id], updated)
      await options.onResourcesChanged()
    })
  }
  const mounted = ref(false)
  onMounted(() => {
    mounted.value = true
    globalThis.addEventListener('keydown', onKeydown)
  })
  onBeforeUnmount(() => globalThis.removeEventListener('keydown', onKeydown))

  // The selected node's actions are in the command palette too (U3), and
  // copy and paste with their shortcuts (bindClipboardKeys).
  const structureActions = useStructureActionsStore()
  const clipboardActions = shallowRef<ComputedRef<StructureAction[]> | null>(null)
  watchEffect(() => {
    const item = selectedItem.value
    // Copy and paste with their shortcuts, in view mode too where they copy.
    const actions: StructureAction[] = [...clipboardActions.value?.value ?? []]
    if (!canEditStructure.value || !item || !hasActions(item)) {
      structureActions.set(actions)
      return
    }
    if (isContainerItem(item)) {
      actions.push(
        { key: 'add', title: t('palette.structure.add', { name: item.title }), icon: 'mdi-plus', run: () => void startCreate(item, item.modelType === 'SubmodelElementList' ? null : 'Property') },
        { key: 'json', title: t('palette.structure.json', { name: item.title }), icon: 'mdi-code-json', run: () => (jsonTarget.value = item) },
      )
    }
    if (item.elementKey) {
      actions.push(
        { key: 'duplicate', title: t('palette.structure.duplicate', { name: item.title }), icon: 'mdi-content-duplicate', run: () => void duplicate(item) },
        { key: 'delete', title: t('palette.structure.delete', { name: item.title }), icon: 'mdi-delete-outline', run: () => (pendingDelete.value = item) },
      )
    }
    structureActions.set(actions)
  })
  onBeforeUnmount(() => structureActions.set([]))

  async function startCreate (item: ShellTreeItem, modelType: ElementModelType | null) {
    await guard(async () => {
      const revision = await structureRevisionOf(item)
      const parent = item.elementKey ? (await structure.read(item.submodelKey, item.elementKey)).value as Record<string, unknown> : null
      const inList = parent?.modelType === 'SubmodelElementList'
      const type = (inList ? parent.typeValueListElement : modelType) as ElementModelType
      const taken = (item.children ?? []).filter(child => !child.more).map(child => child.title)
      creating.value = {
        submodelKey: item.submodelKey,
        parentKey: item.elementKey,
        parentLabel: item.title,
        structureRevision: revision,
        index: null,
        element: newElement(type, inList ? null : uniqueIdShort(type, taken), parent),
        isListChild: inList,
      }
      opened.value = [...new Set([...opened.value, item.id])]
      ui.detailsDrawer = true
    })
  }

  async function afterStructureChange (submodelKey: string) {
    await trees.refresh(submodelKey)
    await queryCache.invalidateQueries({ key: ['targets', targetId.value], exact: true })
    // Paths of list items shift, so cached details may show another element now.
    await queryCache.invalidateQueries({ key: ['targets', targetId.value, 'details'] })
  }

  /**
   * A selection addressed by list index follows a deleted or moved element
   * (`to` is `null` for a delete). False if the selection was deleted with it.
   */
  function followSelection (item: ShellTreeItem, to: number | null): boolean {
    const element = typeof route.query.element === 'string' ? decodeResourceKey(route.query.element) : null
    const changed = item.elementKey ? decodeResourceKey(item.elementKey) : null
    if (route.query.submodel !== item.submodelKey || !element || !changed) {
      return true
    }
    const next = followListChange(element, changed, to)
    if (next !== null && next !== element) {
      void router.replace({ query: { ...route.query, element: resourceKey(next) } })
    }
    return next !== null
  }

  async function onCreated (detail: ElementDetail) {
    const submodelKey = creating.value?.submodelKey
    creating.value = null
    if (submodelKey) {
      await afterStructureChange(submodelKey)
      select(itemId(submodelKey, detail.key))
    }
  }

  async function removeElement () {
    const item = pendingDelete.value
    if (!item?.elementKey) {
      return
    }
    removing.value = true
    await guard(async () => {
      await structure.remove(item.submodelKey, item.elementKey!)
      notifications.notify({ text: t('edit.deleted', { name: item.title }), color: 'success' })
      const parent = trees.parentOf(item.id)
      const wasSelected = selectedId.value === item.id || !followSelection(item, null)
      await afterStructureChange(item.submodelKey)
      if (wasSelected) {
        select(parent?.id ?? null)
      }
    })
    removing.value = false
    pendingDelete.value = null
  }

  async function move (item: ShellTreeItem, delta: -1 | 1) {
    await guard(async () => {
      const parent = trees.parentOf(item.id)
      if (!parent || !item.elementKey) {
        return
      }
      const revision = await structureRevisionOf(parent)
      const to = position(item) + delta
      const moved = await structure.move(item.submodelKey, item.elementKey, to, revision)
      const wasSelected = selectedId.value === item.id
      if (!wasSelected) {
        followSelection(item, to)
      }
      await afterStructureChange(item.submodelKey)
      if (wasSelected) {
        select(itemId(item.submodelKey, moved.key))
      }
    })
  }

  async function copyElement (item: ShellTreeItem) {
    await guard(async () => {
      const detail = await structure.read(item.submodelKey, item.elementKey!)
      const element = detail.value as Record<string, unknown>
      clipboardStore.copy({ element, label: `${item.modelType} ${item.title}` })
      // As AAS JSON on the system clipboard too (C1).
      await copy(JSON.stringify(element, null, 2), item.title)
    })
  }

  /** A model reference to an element, for reference fields (C2). */
  async function copyReference (item: ShellTreeItem) {
    const submodelId = decodeResourceKey(item.submodelKey)
    const locator = decodeResourceKey(item.elementKey!)
    if (!submodelId || !locator) {
      return
    }
    const segments = locator.match(/[^.[\]]+/g) ?? []
    const keys = [
      { type: 'Submodel', value: submodelId },
      ...segments.map((segment, index) => ({ type: index === segments.length - 1 ? item.modelType : 'SubmodelElement', value: segment })),
    ]
    clipboardStore.copyReference({ type: 'ModelReference', keys })
    notifications.notify({ text: t('edit.referenceCopied', { name: item.title }), color: 'info' })
  }

  async function pasteInto (parent: ShellTreeItem) {
    const copied = clipboardStore.copied
    if (!copied) {
      return
    }
    await guard(async () => {
      // A list takes elements of its own type only (package editing plan, K2).
      if (parent.modelType === 'SubmodelElementList' && parent.elementKey) {
        const list = (await structure.read(parent.submodelKey, parent.elementKey)).value as Record<string, unknown>
        const type = list.typeValueListElement
        if (typeof type === 'string' && type !== 'SubmodelElement' && type !== copied.element.modelType) {
          notifications.notify({ text: t('copies.listType', { type, copied: String(copied.element.modelType) }), color: 'error' })
          return
        }
      }
      const revision = await structureRevisionOf(parent)
      const names = (parent.children ?? []).filter(child => !child.more).map(child => child.title)
      const added = await structure.paste(parent.submodelKey, parent.elementKey, revision, copied.element, names, parent.modelType === 'SubmodelElementList')
      notifications.notify({ text: t('edit.pasted', { name: String(added.path) }), color: 'success' })
      opened.value = [...new Set([...opened.value, parent.id])]
      await afterStructureChange(parent.submodelKey)
      select(itemId(parent.submodelKey, added.key))
    })
  }

  /**
   * ⌘C and ⌘V and their palette entries (package editing plan, K10): the
   * selected element first, else what the page copies or pastes (its shell
   * or submodel, a copied resource). Pasting an element needs edit mode (UX-006).
   */
  function bindClipboardKeys (page: { copy?: () => ClipboardCommand | null, paste?: () => ClipboardCommand | null }) {
    clipboardActions.value = useClipboardCommands(
      () => {
        const item = selectedItem.value
        if (item?.elementKey && !item.draft && !item.variableGroup) {
          return { title: t('palette.structure.copy', { name: item.title }), run: () => copyElement(item) }
        }
        // A selected submodel row copies the submodel, not the page's shell.
        if (item && !item.elementKey && item.modelType === 'Submodel' && !item.unavailable && selectedId.value !== options.subject?.()) {
          return { title: t('palette.structure.copy', { name: item.title }), run: () => copies.copySubmodel(targetId.value, item.submodelKey, item.title) }
        }
        return page.copy?.() ?? null
      },
      () => {
        const item = selectedItem.value
        if (canEditStructure.value && clipboardStore.copied && item && isContainerItem(item)) {
          return { title: t('palette.structure.paste', { name: item.title }), run: () => pasteInto(item) }
        }
        return page.paste?.() ?? null
      },
    )
  }

  async function duplicate (item: ShellTreeItem) {
    await guard(async () => {
      const parent = trees.parentOf(item.id)
      if (!parent) {
        return
      }
      const element = (await structure.read(item.submodelKey, item.elementKey!)).value as Record<string, unknown>
      const revision = await structureRevisionOf(parent)
      const names = (parent.children ?? []).filter(child => !child.more).map(child => child.title)
      const added = await structure.paste(item.submodelKey, parent.elementKey, revision, element, names, parent.modelType === 'SubmodelElementList')
      await afterStructureChange(item.submodelKey)
      select(itemId(item.submodelKey, added.key))
    })
  }

  return {
    targetId,
    capabilities,
    submodelRefs,
    mounted,
    // Gates
    canWrite,
    canCreate,
    canEditStructure,
    canInvoke,
    // Point in time and refresh
    asOf,
    asOfIso,
    asOfLabel,
    historyMenu,
    pickDate,
    autoRefresh,
    refreshSeconds,
    toggleAutoRefresh,
    // The tree
    trees,
    treeItems,
    treeSearch,
    opened,
    activated,
    loadChildren,
    expanding,
    expandAll,
    collapseAll,
    resetView,
    templateLabel,
    unitOf,
    liveSignals,
    hasDraft,
    // Selection and the details drawer
    selectedId,
    selectedItem,
    selectedSubmodelLabel,
    selectedRef,
    selectedHistory,
    detailsMode,
    detailsView,
    select,
    openFromOverview,
    followTabs,
    bindClipboardKeys,
    onElementChanged,
    // Structure editing
    creating,
    onCreated,
    actionError,
    guard,
    rowMenuOpen,
    rowMenuActivator,
    menuItem,
    openRowMenu,
    closeRowMenu,
    hasActions,
    isContainerItem,
    addableTypes,
    canMove,
    position,
    siblingCount,
    startCreate,
    pasteInto,
    jsonTarget,
    insertJson,
    convertTarget,
    converting,
    convertToInstance,
    pendingDelete,
    removing,
    removeElement,
    move,
    copyElement,
    copyReference,
    duplicate,
    clipboard: clipboardStore,
  }
}

export type ElementTree = ReturnType<typeof useElementTree>

const elementTreeKey: InjectionKey<ElementTree> = Symbol('element-tree')

/** Makes the page's element tree available to its tree card. */
export function provideElementTree (tree: ElementTree) {
  provide(elementTreeKey, tree)
}

export function injectElementTree (): ElementTree {
  const tree = inject(elementTreeKey)
  if (!tree) {
    throw new Error('The element tree card needs a page that provides an element tree.')
  }
  return tree
}
