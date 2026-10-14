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
        :placeholder="t('shells.filter')"
        prepend-inner-icon="mdi-magnify"
      />

      <v-chip-group v-model="filter" class="mt-1" mandatory selected-class="text-primary">
        <v-chip filter :text="t('shells.all')" value="all" />
        <v-chip filter :text="t('shells.instances')" value="Instance" />
        <v-chip filter :text="t('shells.types')" value="Type" />
        <v-chip filter prepend-icon="mdi-star-outline" :text="t('shells.favorites')" value="favorites" />
      </v-chip-group>
    </div>

    <v-divider />

    <ProblemAlert
      v-if="shells.error.value && items.length === 0"
      class="ma-2"
      :error="shells.error.value"
      retry
      @retry="shells.refetch()"
    />

    <v-skeleton-loader v-else-if="shells.isLoading.value && items.length === 0" type="list-item-avatar-two-line@6" />

    <v-infinite-scroll v-else-if="filtered.length > 0" :items="filtered" @load="loadMore">
      <v-list class="px-2" lines="two" nav>
        <v-list-item
          v-for="shell in filtered"
          :key="shell.key"
          v-intersect.once="(visible: boolean) => visible && seen(shell.key)"
          :active="shell.key === activeKey"
          :title="shellTitle(shell)"
          :to="`/targets/${targetId}/shells/${shell.key}`"
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
      v-else-if="shells.data.value"
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
</template>

<script lang="ts" setup>
  import type { Page, ShellAvailability, ShellSummary } from '#shared/contract'
  import { useInfiniteQuery } from '@pinia/colada'
  import { useDisplay } from 'vuetify'
  import { langText, targetIcon } from '~/utils/aas'

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

  const search = ref('')
  const filter = ref<'all' | 'Instance' | 'Type' | 'favorites'>('all')
  const sortBy = ref(['name'])

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

  const items = computed(() => shells.data.value?.pages.flatMap(page => page.items) ?? [])
  const hasMore = computed(() => shells.hasNextPage.value)
  const thumbnails = computed(() => target.value?.capabilities.files ?? false)

  function shellTitle (shell: ShellSummary): string {
    return langText(shell.displayName) ?? shell.idShort ?? shell.id
  }

  // Filters the loaded shells; ⌘K searches the whole target.
  const filtered = computed(() => {
    const needle = (search.value ?? '').toLowerCase()
    const list = items.value.filter(shell => {
      if (filter.value === 'favorites' && !preferences.isFavorite(props.targetId, shell.key)) {
        return false
      }
      if ((filter.value === 'Instance' || filter.value === 'Type') && shell.assetKind !== filter.value) {
        return false
      }
      return !needle || [shellTitle(shell), shell.idShort, shell.id, shell.globalAssetId].some(value => value?.toLowerCase().includes(needle))
    })
    return sortBy.value[0] === 'name' ? list.toSorted((a, b) => shellTitle(a).localeCompare(shellTitle(b))) : list
  })

  async function loadMore ({ done }: { done: (status: LoadStatus) => void }) {
    if (!shells.hasNextPage.value) {
      done('empty')
      return
    }
    await shells.loadNextPage()
    done(shells.error.value ? 'error' : (shells.hasNextPage.value ? 'ok' : 'empty'))
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
    filter.value = 'all'
  }
</script>
