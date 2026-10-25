<template>
  <!-- The content of the submodel list's drawer, which the layout renders
       (default.vue), for the same reason as the shell list's. -->
  <div class="d-flex flex-column h-100">
    <div class="px-3 pt-3 pb-1">
      <SearchExpressionField
        v-model="search"
        :advanced-enabled="queryable"
        :fields="submodelSearchFields"
        :loading="searching && found.isLoading.value"
        :placeholder="t('submodels.search')"
        :query-active="rawQuery !== null"
        @advanced="queryDialog = true"
        @clear-query="rawQuery = null"
      />

      <div v-if="localOnly && search" class="text-body-small text-medium-emphasis mt-1">{{ t('submodels.localOnly') }}</div>

      <v-menu v-if="canCreate">
        <template #activator="{ props: activator }">
          <v-btn-secondary
            v-bind="activator"
            append-icon="mdi-chevron-down"
            block
            class="mt-2"
            prepend-icon="mdi-plus"
            :text="t('wizard.newSubmodel')"
          />
        </template>

        <v-card>
          <v-list>
            <v-list-item prepend-icon="mdi-file-outline" :title="t('wizard.empty')" @click="emptyOpen = true" />
            <v-list-item prepend-icon="mdi-file-document-outline" :title="t('wizard.fromTemplate')" @click="templateOpen = true" />
            <v-list-item prepend-icon="mdi-code-json" :title="t('wizard.fromJson')" @click="jsonOpen = true" />
          </v-list>
        </v-card>
      </v-menu>

      <!-- Registry descriptors do not carry the kind, so it cannot be filtered. -->
      <div v-tooltip="kindUnknown ? t('submodels.kindUnknown') : undefined">
        <v-chip-group
          v-model="filter"
          class="mt-1"
          :disabled="kindUnknown"
          mandatory
          selected-class="text-primary"
        >
          <v-chip filter :text="t('submodels.all')" value="all" />
          <v-chip filter :text="t('submodels.instances')" value="Instance" />
          <v-chip filter :text="t('submodels.templates')" value="Template" />
        </v-chip-group>
      </div>
    </div>

    <v-divider />

    <!-- Several open packages: one group each (package editing plan, M1). -->
    <PackageListGroups
      v-if="grouped"
      :active-key="activeKey"
      :current-target-id="targetId"
      :expression="applied"
      kind="submodels"
      :kind-filter="filter"
      :search-state="searchState"
    />

    <template v-else>
      <!-- A deep link to a submodel the list has not loaded yet keeps it in sight. -->
      <v-list v-if="pinned" class="flex-shrink-0 px-2 py-1" lines="two" nav>
        <v-list-item
          active
          prepend-icon="mdi-pin-outline"
          :subtitle="pinned.id"
          :title="pinned.title"
          :to="rowLink(activeKey!)"
        />
      </v-list>

      <ProblemAlert
        v-if="source.error.value && items.length === 0"
        class="ma-2"
        :error="source.error.value"
        retry
        @retry="source.refetch()"
      />

      <v-skeleton-loader v-else-if="loading && items.length === 0" type="list-item-two-line@6" />

      <!-- Virtualized: only the visible rows exist; rows near the end load the next page. -->
      <v-list
        v-else-if="filtered.length > 0"
        class="flex-grow-1 px-2 py-0"
        height="0"
        lines="two"
        nav
      >
        <v-virtual-scroll ref="scroller" height="100%" item-key="key" :items="filtered">
          <template #default="{ item: submodel, index }">
            <v-list-item
              v-intersect.once="(visible: boolean) => visible && onRowSeen(submodel.key, index)"
              :active="submodel.key === activeKey"
              :class="index === 0 ? 'mt-2' : undefined"
              :title="submodelTitle(submodel)"
              :to="rowLink(submodel.key)"
              @click="onOpen"
            >
              <template #prepend>
                <v-avatar :color="submodel.kind === 'Template' ? 'warning' : 'primary'" size="36" variant="tonal">
                  <v-icon :icon="modelTypeIcon('Submodel')" />
                </v-avatar>
              </template>

              <template #subtitle>{{ submodel.id }}</template>

              <!-- As the shell list marks types; the template a semantic ID names is in the header.
                   The marker sits at the edge, so it lines up from row to row. -->
              <template #append>
                <v-chip
                  v-if="submodel.kind === 'Template'"
                  class="me-1"
                  color="warning"
                  size="x-small"
                  :text="t('submodels.template')"
                />

                <v-icon
                  v-if="orphans[submodel.key]"
                  v-tooltip="t('submodels.orphan')"
                  :aria-label="t('submodels.orphan')"
                  class="me-1"
                  color="warning"
                  icon="mdi-link-variant-off"
                  size="small"
                />
              </template>
            </v-list-item>
          </template>
        </v-virtual-scroll>
      </v-list>

      <v-empty-state
        v-else-if="source.data.value && unfiltered && !source.hasNextPage.value"
        icon="mdi-file-tree-outline"
        size="64"
        :text="t('submodels.emptyText')"
        :title="t('submodels.empty')"
      />

      <v-empty-state
        v-else-if="source.data.value && !source.hasNextPage.value"
        icon="mdi-file-hidden"
        size="64"
        :text="t('submodels.noneText')"
        :title="t('submodels.none')"
      >
        <template #actions>
          <v-btn :text="t('shells.reset')" variant="tonal" @click="reset" />
        </template>
      </v-empty-state>

      <!-- Outside the v-if chain above: the next page is loading below the rows. -->
      <v-progress-linear v-if="loadingMore" class="flex-shrink-0" />

      <!-- A kind filter that matched little: further pages load on request. -->
      <div v-else-if="source.data.value && source.hasNextPage.value && filtered.length < fillRows" class="pa-2 flex-shrink-0">
        <v-btn block prepend-icon="mdi-chevron-down" :text="t('submodels.loadMore')" @click="loadMore" />
      </div>
    </template>

    <v-divider />

    <v-list class="px-2 flex-shrink-0">
      <v-list-item
        :prepend-icon="target ? targetIcon(target) : 'mdi-server-network'"
        :subtitle="target?.capabilities.submodelListSource === 'registry' ? t('submodels.fromRegistry') : t('submodels.fromRepository')"
        :title="target?.name"
        :to="`/targets/${targetId}`"
      />
    </v-list>
  </div>

  <ShellQueryDialog
    v-if="queryable"
    v-model="queryDialog"
    :expression="search ?? ''"
    :query="rawQuery"
    query-target="submodels"
    :target-id="targetId"
    @apply="rawQuery = $event"
  />

  <template v-if="canCreate">
    <SubmodelAddDialog v-model="emptyOpen" :target-id="targetId" @created="onCreated" />

    <SubmodelTemplateDialog v-model="templateOpen" :target-id="targetId" @created="onCreated" />

    <JsonInsertDialog
      v-model="jsonOpen"
      kind="submodel"
      :submit="createFromJson"
      :target-id="targetId"
      :title="t('submodels.fromJsonTitle')"
    />
  </template>
</template>

<script lang="ts" setup>
  import type { LangString, Page, SubmodelDetail, SubmodelOwners, SubmodelSearchPage, SubmodelSummary } from '#shared/contract'
  import type { ParsedSearch } from '#shared/search/expression'
  import { useInfiniteQuery, useQuery, useQueryCache } from '@pinia/colada'
  import { useDisplay } from 'vuetify'
  import { parseSearch, submodelSearchFields } from '#shared/search/expression'
  import { langText, modelTypeIcon, targetIcon } from '~/utils/aas'

  // The submodels of a target on their own (the submodel view), as the shell
  // list does it for shells: a search, the kind, cursor pages and the open
  // submodel kept in sight.
  const props = defineProps<{ targetId: string, activeKey: string | null }>()

  const { t } = useI18n()
  const api = useStudioApi()
  const ui = useUiStore()
  const router = useRouter()
  const queryCache = useQueryCache()
  const invalidate = useInvalidate()
  const { mobile } = useDisplay()
  const targetQuery = useTarget(() => props.targetId)
  const { grouped } = useOpenPackages(() => props.targetId)
  const target = targetQuery.data
  // Creating needs edit mode (MVP-5 plan, T3).
  const canCreate = computed(() => ui.editing && Boolean(target.value?.capabilities.createResources))
  const emptyOpen = ref(false)
  const templateOpen = ref(false)
  const jsonOpen = ref(false)

  const filter = ref<'all' | 'Instance' | 'Template'>('all')
  const kindUnknown = computed(() => target.value?.capabilities.submodelListSource === 'registry')
  watch(kindUnknown, unknown => {
    if (unknown) {
      filter.value = 'all'
    }
  }, { immediate: true })

  // The search, kept in the URL as on the shell list.
  const { search, applied, rawQuery, searchState, clear: clearSearch } = useListSearch()
  const queryDialog = ref(false)

  const queryable = computed(() => target.value?.capabilities.submodelSearch === 'query')
  // AASX workspaces evaluate expressions themselves; other targets need a query endpoint.
  const serverSearch = computed(() => target.value !== undefined && target.value.capabilities.submodelSearch !== 'filter')
  const localOnly = computed(() => target.value !== undefined && !serverSearch.value)
  const searching = computed(() => serverSearch.value && (rawQuery.value !== null || applied.value !== ''))
  const unfiltered = computed(() => applied.value === '' && rawQuery.value === null && filter.value === 'all')
  const enabled = () => target.value !== undefined && target.value.authenticationState !== 'required' && Boolean(target.value.capabilities.submodelListSource)

  const submodels = useInfiniteQuery({
    key: () => ['targets', props.targetId, 'submodels'],
    query: ({ pageParam, signal }) => api<Page<SubmodelSummary>>(`/targets/${props.targetId}/submodels`, {
      query: { limit: 100, cursor: pageParam ?? undefined },
      signal,
    }),
    initialPageParam: null as string | null,
    getNextPageParam: lastPage => lastPage.page.nextCursor,
    enabled,
  })

  const mounted = ref(false)
  onMounted(() => (mounted.value = true))
  const found = useInfiniteQuery({
    key: () => ['targets', props.targetId, 'submodels', 'search', rawQuery.value ?? applied.value],
    query: ({ pageParam, signal }) => api<SubmodelSearchPage>(`/targets/${props.targetId}/searches`, {
      method: 'POST',
      body: {
        scope: 'submodels',
        ...(rawQuery.value ? { query: rawQuery.value } : { expression: applied.value }),
        limit: 100,
        cursor: pageParam ?? undefined,
      },
      signal,
    }),
    initialPageParam: null as string | null,
    getNextPageParam: lastPage => lastPage.page.nextCursor,
    // Searches are POST requests, which only the browser can make.
    enabled: () => mounted.value && searching.value && enabled(),
  })

  const source = computed(() => (searching.value ? found : submodels))
  const loading = computed(() => source.value.isLoading.value || (searching.value && !mounted.value))
  const items = computed(() => source.value.data.value?.pages.flatMap(page => page.items) ?? [])

  function submodelTitle (submodel: Pick<SubmodelSummary, 'displayName' | 'idShort' | 'id'>): string {
    return langText(submodel.displayName) ?? submodel.idShort ?? submodel.id
  }

  /** Without a query endpoint, the search filters the loaded submodels by the fields a row has. */
  function matchesLocally (submodel: SubmodelSummary, parsed: ParsedSearch): boolean {
    const fields: Record<string, string | null> = { id: submodel.id, idShort: submodel.idShort, semanticId: submodel.semanticId }
    const needle = parsed.text.toLowerCase()
    if (needle && ![submodelTitle(submodel), submodel.idShort, submodel.id, submodel.semanticId].some(value => value?.toLowerCase().includes(needle))) {
      return false
    }
    return parsed.filters.every(item => {
      const value = fields[item.field] ?? null
      const found = value !== null && (item.operator === 'contains' ? value.includes(item.value) : value === item.value)
      return item.operator === 'not-equals' ? !found : found
    })
  }

  // The kind is filtered here: the AAS Query Language has no field for it.
  const filtered = computed(() => {
    const local = parseSearch(applied.value, submodelSearchFields)
    return items.value.filter(submodel => (filter.value === 'all' || submodel.kind === filter.value)
      && (searching.value || matchesLocally(submodel, local)))
  })

  const rowLink = (key: string) => ({ path: `/targets/${props.targetId}/submodels`, query: { ...searchState.value, submodel: key } })

  // The open submodel stays in sight: the list scrolls to it once it is
  // loaded, and until then it is pinned above the list.
  const scroller = useTemplateRef<{ scrollToIndex: (index: number) => void }>('scroller')
  let scrolledTo: string | null = null
  watch([() => props.activeKey, () => filtered.value.length], async ([key]) => {
    const index = key ? filtered.value.findIndex(submodel => submodel.key === key) : -1
    if (key && index >= 0 && scrolledTo !== key) {
      scrolledTo = key
      await nextTick()
      scroller.value?.scrollToIndex(Math.max(0, index - 2))
    }
  }, { immediate: true })
  const pinned = computed(() => {
    const key = props.activeKey
    if (!key || items.value.some(submodel => submodel.key === key)) {
      return null
    }
    const detail = queryCache.getQueryData<SubmodelDetail>(['targets', props.targetId, 'submodels', key])
    const submodel = detail?.submodel as { id?: string, idShort?: string, displayName?: LangString[] } | undefined
    return submodel?.id ? { id: submodel.id, title: submodelTitle({ displayName: submodel.displayName ?? [], idShort: submodel.idShort ?? null, id: submodel.id }) } : null
  })

  // The next page, once one of the last rows is on screen, or while a kind
  // filter leaves fewer rows than fill the list.
  const loadingMore = ref(false)
  async function loadMore () {
    const list = source.value
    if (!list.hasNextPage.value || loadingMore.value) {
      return
    }
    loadingMore.value = true
    try {
      await list.loadNextPage()
    } finally {
      loadingMore.value = false
    }
  }
  function onRowSeen (key: string, index: number) {
    seen(key)
    if (index >= filtered.value.length - 20) {
      void loadMore()
    }
  }
  // Rows that fill the list, and pages read on their own to find them.
  const fillRows = 20
  const autoPages = 5
  watch(() => [filtered.value.length, source.value.data.value?.pages.length], () => {
    const pages = source.value.data.value?.pages.length ?? 0
    if (filtered.value.length < fillRows && pages > 0 && pages < autoPages) {
      void loadMore()
    }
  })

  // Orphan markers: the shells that reference the rows in view are asked for
  // in batches. A submodel counts as an orphan only where the answer covers
  // every shell; markers are a hint, so failures are ignored.
  const orphans = ref<Record<string, boolean>>({})
  const checked = new Set<string>()
  const pending = new Set<string>()
  let checkTimer: ReturnType<typeof setTimeout> | undefined
  function seen (key: string) {
    if (checked.has(key)) {
      return
    }
    checked.add(key)
    pending.add(key)
    clearTimeout(checkTimer)
    checkTimer = setTimeout(checkOwners, 300)
  }
  async function checkOwners () {
    const keys = [...pending].slice(0, 100)
    for (const key of keys) {
      pending.delete(key)
    }
    if (keys.length === 0) {
      return
    }
    const targetId = props.targetId
    try {
      const result = await api<SubmodelOwners>(`/targets/${targetId}/submodel-owners`, { method: 'POST', body: { keys } })
      if (targetId === props.targetId && result.complete) {
        orphans.value = { ...orphans.value, ...Object.fromEntries(result.items.map(item => [item.key, item.shells.length === 0])) }
      }
    } catch {
      // Without markers the list still works.
    }
    if (pending.size > 0) {
      checkTimer = setTimeout(checkOwners, 300)
    }
  }
  watch(() => props.targetId, () => {
    orphans.value = {}
    checked.clear()
    pending.clear()
  })
  onScopeDispose(() => clearTimeout(checkTimer))
  // The open submodel's shells, as its page reads them (the same query): a
  // reference added or removed there shows here too.
  const activeOwners = useQuery({
    key: () => ['targets', props.targetId, 'submodels', props.activeKey ?? '', 'shells'],
    query: ({ signal }) => api<SubmodelOwners>(`/targets/${props.targetId}/submodels/${props.activeKey}/shells`, { signal }),
    enabled: () => props.activeKey !== null && enabled(),
  })
  watch(() => activeOwners.data.value, owners => {
    const key = owners?.items[0]?.key
    if (key && owners.complete) {
      orphans.value = { ...orphans.value, [key]: owners.items[0]!.shells.length === 0 }
    }
  })

  function onOpen () {
    if (mobile.value) {
      ui.listDrawer = false
    }
  }

  function reset () {
    clearSearch()
    filter.value = 'all'
  }

  async function onCreated (submodelKey: string) {
    await router.push(rowLink(submodelKey))
    await invalidate(['targets', props.targetId])
  }

  async function createFromJson (submodel: Record<string, unknown>) {
    const result = await api<{ submodelKey: string }>(`/targets/${props.targetId}/submodels`, { method: 'POST', body: { submodel: { source: 'json', submodel } } })
    await onCreated(result.submodelKey)
  }
</script>
