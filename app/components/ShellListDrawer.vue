<template>
  <v-navigation-drawer v-model="open" width="340">
    <v-toolbar color="transparent" density="comfortable">
      <v-toolbar-title class="text-title-medium font-weight-semibold">
        {{ t('shells.title') }}
        <v-chip class="ms-1" :text="hasMore ? `${filtered.length}+` : String(filtered.length)" />
      </v-toolbar-title>

      <v-menu>
        <template #activator="{ props: activator }">
          <v-btn
            v-tooltip="t('shells.sort')"
            v-bind="activator"
            :aria-label="t('shells.sort')"
            class="me-2"
            icon="mdi-sort"
            size="small"
          />
        </template>

        <v-card>
          <v-list v-model:selected="sortBy" density="compact" mandatory>
            <v-list-item prepend-icon="mdi-sort-alphabetical-ascending" :title="t('shells.sortName')" value="name" />
            <v-list-item prepend-icon="mdi-database-outline" :title="t('shells.sortServer')" value="server" />
          </v-list>
        </v-card>
      </v-menu>
    </v-toolbar>

    <div class="px-4 pb-2">
      <v-text-field
        v-model="search"
        clearable
        density="compact"
        :disabled="rawQuery !== null"
        :hint="localOnly && search ? t('shells.localOnly') : undefined"
        persistent-hint
        :placeholder="t('shells.filter')"
        prepend-inner-icon="mdi-magnify"
      >
        <template #append-inner>
          <v-menu location="bottom end">
            <template #activator="{ props: activator }">
              <v-icon v-bind="activator" :aria-label="t('shells.syntax.title')" icon="mdi-help-circle-outline" size="small" />
            </template>

            <v-card max-width="320">
              <v-list density="compact" lines="two">
                <v-list-subheader :title="t('shells.syntax.title')" />

                <v-list-item
                  v-for="example in syntaxExamples"
                  :key="example"
                  :subtitle="t(`shells.syntax.${example}`)"
                  :title="syntaxSamples[example]"
                />
              </v-list>
            </v-card>
          </v-menu>
        </template>

        <template v-if="queryTarget" #append>
          <v-btn
            v-tooltip="t('shells.query.title')"
            :aria-label="t('shells.query.title')"
            :color="rawQuery ? 'primary' : undefined"
            icon="mdi-code-json"
            size="small"
            @click="queryDialog = true"
          />
        </template>
      </v-text-field>

      <div v-if="rawQuery || parsed.filters.length > 0" class="d-flex flex-wrap ga-1 mt-2">
        <v-chip
          v-if="rawQuery"
          closable
          color="primary"
          prepend-icon="mdi-code-json"
          :text="t('shells.query.active')"
          @click="queryDialog = true"
          @click:close="rawQuery = null"
        />

        <v-chip
          v-for="(item, index) in rawQuery ? [] : parsed.filters"
          :key="`${item.field}:${index}`"
          closable
          :color="item.operator === 'not-equals' ? 'error' : undefined"
          :text="formatFilter(item)"
          @click:close="search = withoutFilter(parsed, index)"
        />
      </div>

      <v-chip-group v-model="filter" class="mt-1" mandatory selected-class="text-primary">
        <v-chip filter :text="t('shells.all')" value="all" />
        <v-chip filter :text="t('shells.instances')" value="Instance" />
        <v-chip filter :text="t('shells.types')" value="Type" />
        <v-chip filter prepend-icon="mdi-star-outline" :text="t('shells.favorites')" value="favorites" />
      </v-chip-group>
    </div>

    <v-divider />

    <ProblemAlert
      v-if="source.error.value && items.length === 0"
      class="ma-2"
      :error="source.error.value"
      retry
      @retry="source.refetch()"
    />

    <v-skeleton-loader v-else-if="loading && items.length === 0" type="list-item-avatar-two-line@6" />

    <v-infinite-scroll v-else-if="filtered.length > 0" :items="filtered" @load="loadMore">
      <v-list class="px-2" lines="two" nav>
        <v-list-item
          v-for="shell in filtered"
          :key="shell.key"
          v-intersect.once="(visible: boolean) => visible && seen(shell.key)"
          :active="shell.key === activeKey"
          :title="shellTitle(shell)"
          :to="{ path: `/targets/${targetId}/shells/${shell.key}`, query: searchState }"
          @click="onOpen"
        >
          <template #prepend>
            <ShellAvatar :shell="shell" size="44" :target-id="targetId" :thumbnails="thumbnails" />
          </template>

          <template #subtitle>{{ shell.id }}</template>

          <template #append>
            <v-icon
              v-if="availability[shell.key] && availability[shell.key] !== 'available'"
              v-tooltip="t(`shells.availability.${availability[shell.key]}`)"
              :aria-label="t(`shells.availability.${availability[shell.key]}`)"
              class="me-1"
              color="error"
              :icon="availabilityIcons[availability[shell.key]!]"
              size="small"
            />

            <v-chip
              v-if="shell.assetKind === 'Type'"
              class="me-1"
              color="warning"
              size="x-small"
              :text="t('shells.type')"
            />

            <v-btn
              :aria-label="t('shells.favorite')"
              :color="preferences.isFavorite(targetId, shell.key) ? 'warning' : undefined"
              :icon="preferences.isFavorite(targetId, shell.key) ? 'mdi-star' : 'mdi-star-outline'"
              @click.stop.prevent="preferences.toggleFavorite(targetId, shell.key)"
            />
          </template>
        </v-list-item>
      </v-list>

      <template #empty />
    </v-infinite-scroll>

    <v-empty-state
      v-else-if="source.data.value"
      icon="mdi-cube-off-outline"
      size="64"
      :text="t('shells.noneText')"
      :title="t('shells.none')"
    >
      <template #actions>
        <v-btn :text="t('shells.reset')" variant="tonal" @click="reset" />
      </template>
    </v-empty-state>

    <template #append>
      <v-divider />

      <v-list class="px-2" density="compact">
        <v-list-item
          :prepend-icon="target ? targetIcon(target) : 'mdi-server-network'"
          :subtitle="preferences.preferences.value.autoRefresh ? t('shells.refreshOn', { seconds: preferences.preferences.value.refreshIntervalSeconds }) : t('shells.refreshOff')"
          :title="target?.name"
          :to="`/targets/${targetId}`"
        />
      </v-list>
    </template>
  </v-navigation-drawer>

  <ShellQueryDialog
    v-if="queryTarget"
    v-model="queryDialog"
    :expression="search ?? ''"
    :query="rawQuery"
    :query-target="queryTarget"
    :target-id="targetId"
    @apply="rawQuery = $event"
  />
</template>

<script lang="ts" setup>
  import type { Page, ShellAvailability, ShellSearchPage, ShellSummary } from '#shared/contract'
  import type { ParsedSearch } from '#shared/search/expression'
  import { useInfiniteQuery } from '@pinia/colada'
  import { useDisplay } from 'vuetify'
  import { formatFilter, parseSearch, withoutFilter } from '#shared/search/expression'
  import { decodeResourceKey, langText, resourceKey, targetIcon } from '~/utils/aas'

  type LoadStatus = 'ok' | 'empty' | 'error' | 'loading'

  const props = defineProps<{ targetId: string, activeKey: string | null }>()

  const { t } = useI18n()
  const api = useStudioApi()
  const ui = useUiStore()
  const preferences = usePreferences()
  const { mdAndUp, mobile } = useDisplay()
  const target = useTarget(() => props.targetId).data

  const open = computed({
    get: () => ui.listDrawer ?? mdAndUp.value,
    set: (value: boolean) => (ui.listDrawer = value),
  })

  const route = useRoute()
  const router = useRouter()

  const filter = ref<'all' | 'Instance' | 'Type' | 'favorites'>('all')
  const sortBy = ref(['name'])

  // The search (MVP-4 plan, S2): the Web UI's expression syntax, or a raw
  // query from the advanced dialog, kept in the URL as `?search=` and
  // `?query=` (base64url JSON) so that links and reloads keep the list.
  function queryFromRoute (): Record<string, unknown> | null {
    const encoded = route.query.query
    const json = typeof encoded === 'string' ? decodeResourceKey(encoded) : null
    try {
      const value: unknown = json ? JSON.parse(json) : null
      return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
    } catch {
      return null
    }
  }
  const searchFromRoute = () => (typeof route.query.search === 'string' ? route.query.search : '')

  const search = ref<string | null>(searchFromRoute())
  const rawQuery = ref<Record<string, unknown> | null>(queryFromRoute())
  const applied = ref(searchFromRoute().trim())
  const queryDialog = ref(false)
  const parsed = computed<ParsedSearch>(() => parseSearch(search.value ?? ''))

  let searchTimer: ReturnType<typeof setTimeout> | undefined
  watch(search, value => {
    clearTimeout(searchTimer)
    searchTimer = setTimeout(() => (applied.value = (value ?? '').trim()), 300)
  })

  const searchState = computed(() => ({
    search: applied.value || undefined,
    query: rawQuery.value ? resourceKey(JSON.stringify(rawQuery.value)) : undefined,
  }))
  watch(searchState, state => {
    if (state.search !== route.query.search || state.query !== route.query.query) {
      void router.replace({ query: { ...route.query, ...state } })
    }
  })
  // Back and forward restore the search of the URL.
  watch(() => [route.query.search, route.query.query], () => {
    if (searchFromRoute().trim() !== applied.value) {
      search.value = searchFromRoute()
      applied.value = searchFromRoute().trim()
    }
    if (route.query.query !== searchState.value.query) {
      rawQuery.value = queryFromRoute()
    }
  })

  const queryTarget = computed(() => target.value?.capabilities.queryTarget ?? null)
  // AASX workspaces evaluate expressions themselves; other targets need a query endpoint.
  const serverSearch = computed(() => target.value !== undefined && target.value.capabilities.search !== 'filter')
  const localOnly = computed(() => target.value !== undefined && !serverSearch.value)
  const kindFilter = computed(() => (filter.value === 'Instance' || filter.value === 'Type' ? `assetKind=${filter.value}` : ''))
  const expression = computed(() => [applied.value, kindFilter.value].filter(Boolean).join(' '))
  const searching = computed(() => serverSearch.value && (rawQuery.value !== null || expression.value !== ''))

  const shells = useInfiniteQuery({
    key: () => ['targets', props.targetId, 'shells'],
    query: ({ pageParam, signal }) => api<Page<ShellSummary>>(`/targets/${props.targetId}/shells`, {
      query: { limit: 100, cursor: pageParam ?? undefined },
      signal,
    }),
    initialPageParam: null as string | null,
    getNextPageParam: lastPage => lastPage.page.nextCursor,
    enabled: () => target.value !== undefined && target.value.authenticationState !== 'required',
  })

  const mounted = ref(false)
  onMounted(() => (mounted.value = true))
  const found = useInfiniteQuery({
    key: () => ['targets', props.targetId, 'shells', 'search', rawQuery.value ?? expression.value],
    query: ({ pageParam, signal }) => api<ShellSearchPage>(`/targets/${props.targetId}/searches`, {
      method: 'POST',
      body: {
        scope: 'shells',
        ...(rawQuery.value ? { query: rawQuery.value } : { expression: expression.value }),
        limit: 100,
        cursor: pageParam ?? undefined,
      },
      signal,
    }),
    initialPageParam: null as string | null,
    getNextPageParam: lastPage => lastPage.page.nextCursor,
    // Searches are POST requests, which only the browser can make (they need
    // its Origin); the server renders the list as loading.
    enabled: () => mounted.value && searching.value && target.value?.authenticationState !== 'required',
  })
  const loading = computed(() => source.value.isLoading.value || (searching.value && !mounted.value))

  const source = computed(() => (searching.value ? found : shells))
  const items = computed(() => source.value.data.value?.pages.flatMap(page => page.items) ?? [])
  const hasMore = computed(() => source.value.hasNextPage.value)
  const thumbnails = computed(() => target.value?.capabilities.files ?? false)

  function shellTitle (shell: ShellSummary): string {
    return langText(shell.displayName) ?? shell.idShort ?? shell.id
  }

  // Without a query endpoint, the search filters the loaded shells by the
  // fields a list row has, with the hint that it does not cover the target.
  const summaryFields: Partial<Record<ParsedSearch['filters'][number]['field'], (shell: ShellSummary) => string | null>> = {
    id: shell => shell.id,
    idShort: shell => shell.idShort,
    assetKind: shell => shell.assetKind,
    globalAssetId: shell => shell.globalAssetId,
  }
  function matchesLocally (shell: ShellSummary, search: ParsedSearch): boolean {
    const needle = search.text.toLowerCase()
    if (needle && ![shellTitle(shell), shell.idShort, shell.id, shell.globalAssetId].some(value => value?.toLowerCase().includes(needle))) {
      return false
    }
    return search.filters.every(item => {
      const value = summaryFields[item.field]?.(shell) ?? null
      const found = value !== null && (item.operator === 'contains' ? value.includes(item.value) : value === item.value)
      return item.operator === 'not-equals' ? !found : found
    })
  }

  const filtered = computed(() => {
    const local = parseSearch(applied.value)
    const list = items.value.filter(shell => {
      if (filter.value === 'favorites' && !preferences.isFavorite(props.targetId, shell.key)) {
        return false
      }
      // Server searches include the kind, except raw queries, which stay as written.
      const kindOnServer = searching.value && rawQuery.value === null
      if (!kindOnServer && (filter.value === 'Instance' || filter.value === 'Type') && shell.assetKind !== filter.value) {
        return false
      }
      return searching.value || matchesLocally(shell, local)
    })
    return sortBy.value[0] === 'name' ? list.toSorted((a, b) => shellTitle(a).localeCompare(shellTitle(b))) : list
  })

  async function loadMore ({ done }: { done: (status: LoadStatus) => void }) {
    const list = source.value
    if (!list.hasNextPage.value) {
      done('empty')
      return
    }
    await list.loadNextPage()
    done(list.error.value ? 'error' : (list.hasNextPage.value ? 'ok' : 'empty'))
  }

  // Online markers (as in the BaSyx AAS Web UI): registry entries may point to
  // shells that cannot be opened. Rows are checked once when they come into
  // view, in batches; the markers are a hint, so failures are ignored.
  type Status = ShellAvailability['items'][number]['status']
  const availabilityIcons: Record<Status, string> = {
    available: 'mdi-check',
    forbidden: 'mdi-lock-outline',
    not_found: 'mdi-help-circle-outline',
    blocked: 'mdi-link-variant-off',
    unreachable: 'mdi-cloud-off-outline',
  }
  const availability = ref<Record<string, Status>>({})
  const pending = new Set<string>()
  let checkTimer: ReturnType<typeof setTimeout> | undefined
  function seen (key: string) {
    if (target.value?.capabilities.listSource !== 'registry' || key in availability.value) {
      return
    }
    pending.add(key)
    clearTimeout(checkTimer)
    checkTimer = setTimeout(checkAvailability, 300)
  }
  async function checkAvailability () {
    const keys = [...pending].slice(0, 50)
    for (const key of keys) {
      pending.delete(key)
    }
    if (keys.length === 0) {
      return
    }
    const targetId = props.targetId
    try {
      const result = await api<ShellAvailability>(`/targets/${targetId}/shell-availability`, { method: 'POST', body: { keys } })
      if (targetId === props.targetId) {
        availability.value = { ...availability.value, ...Object.fromEntries(result.items.map(item => [item.key, item.status])) }
      }
    } catch {
      // Without markers the list still works.
    }
    if (pending.size > 0) {
      checkTimer = setTimeout(checkAvailability, 300)
    }
  }
  watch(() => props.targetId, () => {
    availability.value = {}
    pending.clear()
  })
  onScopeDispose(() => clearTimeout(checkTimer))

  function onOpen () {
    if (mobile.value) {
      ui.listDrawer = false
    }
  }

  function reset () {
    search.value = ''
    applied.value = ''
    rawQuery.value = null
    filter.value = 'all'
  }

  const syntaxExamples = ['text', 'contains', 'equals', 'excludes', 'quoted'] as const
  const syntaxSamples: Record<(typeof syntaxExamples)[number], string> = {
    text: 'motor',
    contains: 'idShort:Drive',
    equals: 'assetKind=Type',
    excludes: '-id:urn:example  ·  id!=urn:example',
    quoted: 'idShort:"Drive motor"',
  }

  onScopeDispose(() => clearTimeout(searchTimer))
</script>
