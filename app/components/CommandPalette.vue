<template>
  <v-dialog
    v-model="ui.commandOpen"
    :fullscreen="xs"
    location="top"
    location-strategy="static"
    max-width="640"
    scrollable
  >
    <v-card :class="xs ? undefined : 'mt-16'" max-height="600">
      <v-text-field
        v-model="query"
        autofocus
        :placeholder="targetId ? t('palette.placeholderTarget') : t('palette.placeholder')"
        prepend-inner-icon="mdi-magnify"
        rounded="0"
        variant="solo"
        @keydown.down.prevent="move(1)"
        @keydown.enter.prevent="run(results[cursor])"
        @keydown.up.prevent="move(-1)"
      >
        <template #append-inner>
          <v-progress-circular
            v-if="searching"
            class="me-2"
            indeterminate
            size="18"
            width="2"
          />

          <v-hotkey keys="escape" />
        </template>
      </v-text-field>

      <v-divider />

      <v-card-text class="pa-2">
        <ProblemAlert v-if="error" class="mb-2" :error="error" />

        <v-list v-if="results.length > 0" nav>
          <template v-for="(item, index) in results" :key="item.key">
            <v-list-subheader v-if="index === 0 || results[index - 1]!.group !== item.group" :title="item.group" />

            <v-list-item
              :active="index === cursor"
              :prepend-icon="item.icon"
              :subtitle="item.subtitle"
              :title="item.title"
              @click="run(item)"
              @mouseenter="cursor = index"
            >
              <template v-if="item.keys" #append>
                <v-hotkey :keys="item.keys" />
              </template>
            </v-list-item>
          </template>
        </v-list>

        <v-empty-state
          v-else-if="!searching"
          icon="mdi-text-search-variant"
          size="56"
          :text="t('palette.emptyText')"
          :title="t('palette.empty', { query })"
        />
      </v-card-text>

      <v-divider />

      <v-card-actions class="px-4 text-label-small text-medium-emphasis">
        <v-hotkey keys="arrowup" /> <v-hotkey keys="arrowdown" /> {{ t('palette.navigate') }}
        <v-hotkey class="ms-3" keys="enter" /> {{ t('palette.open') }}
        <v-spacer />
        {{ t('palette.results', results.length) }}
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script lang="ts" setup>
  import type { SearchResult, ShellSummary } from '#shared/contract'
  import { useDisplay, useTheme } from 'vuetify'
  import { decodeResourceKey, langText, modelTypeIcon } from '~/utils/aas'

  const props = defineProps<{ targetId: string | null }>()

  interface PaletteItem {
    key: string
    group: string
    title: string
    subtitle?: string
    icon: string
    keys?: string
    run: () => unknown
  }

  const { t } = useI18n()
  const { xs } = useDisplay()
  const theme = useTheme()
  const router = useRouter()
  const api = useStudioApi()
  const session = useSessionStore()
  const ui = useUiStore()
  const preferences = usePreferences()
  const target = useTarget(() => props.targetId ?? '')

  const query = ref('')
  const cursor = ref(0)
  const searching = ref(false)
  const error = ref<unknown>(null)
  const found = ref<SearchResult>({ shells: [], elements: [] })
  const lookedUp = ref<ShellSummary[] | null>(null)

  const trimmed = computed(() => query.value.trim())
  const looksLikeAssetId = computed(() => /[:/]/.test(trimmed.value))

  function openShell (shellKey: string, location: Record<string, string> = {}) {
    void router.push({ path: `/targets/${props.targetId}/shells/${shellKey}`, query: location })
  }

  const actions = computed<PaletteItem[]>(() => {
    const base = props.targetId ? `/targets/${props.targetId}` : null
    const items: PaletteItem[] = [
      { key: 'theme', group: '', title: t('palette.actions.theme'), icon: 'mdi-theme-light-dark', run: () => preferences.update(current => ({ ...current, theme: theme.current.value.dark ? 'light' : 'dark' })) },
      { key: 'targets', group: '', title: t('palette.actions.targets'), icon: 'mdi-server-network', run: () => router.push('/') },
      { key: 'settings', group: '', title: t('palette.actions.settings'), icon: 'mdi-cog-outline', run: () => router.push('/settings') },
    ]
    if (base) {
      items.push(
        { key: 'mode', group: '', title: t('palette.actions.mode'), icon: 'mdi-pencil-outline', keys: 'cmd+e', run: () => ui.toggleMode() },
        { key: 'refresh', group: '', title: t('palette.actions.refresh'), icon: 'mdi-refresh-auto', run: () => preferences.update(current => ({ ...current, autoRefresh: !current.autoRefresh })) },
        { key: 'dashboard', group: '', title: t('palette.actions.dashboard'), icon: 'mdi-view-dashboard-outline', run: () => router.push(base) },
      )
      if (target.data.value?.capabilities.conceptDescriptions) {
        items.push({ key: 'concepts', group: '', title: t('palette.actions.concepts'), icon: 'mdi-book-open-page-variant-outline', run: () => router.push(`${base}/concepts`) })
      }
    }
    if (session.isAdmin) {
      items.push({ key: 'infrastructures', group: '', title: t('palette.actions.infrastructures'), icon: 'mdi-server-plus-outline', run: () => router.push('/admin/infrastructures') })
    }
    return items.map(item => ({ ...item, group: t('palette.groups.actions') }))
  })

  const results = computed<PaletteItem[]>(() => {
    const needle = trimmed.value.toLowerCase()
    const items: PaletteItem[] = []
    if (props.targetId && looksLikeAssetId.value && target.data.value?.capabilities.discovery) {
      if (lookedUp.value === null) {
        items.push({
          key: 'lookup',
          group: t('palette.groups.discovery'),
          title: t('palette.lookup', { assetId: trimmed.value }),
          icon: 'mdi-barcode-scan',
          run: () => lookup(),
        })
      } else {
        items.push(...lookedUp.value.map(shell => ({
          key: `lookup:${shell.key}`,
          group: t('palette.groups.discovery'),
          title: langText(shell.displayName) ?? shell.idShort ?? shell.id,
          subtitle: shell.id,
          icon: 'mdi-cube-outline',
          run: () => openShell(shell.key),
        })))
      }
    }
    if (props.targetId && needle.length < 2) {
      items.push(...preferences.recent(props.targetId).slice(0, 4).map(entry => ({
        key: `recent:${entry.key}`,
        group: t('palette.groups.recent'),
        title: entry.title ?? decodeResourceKey(entry.key) ?? entry.key,
        icon: 'mdi-history',
        run: () => openShell(entry.key),
      })))
    }
    const shells = found.value.shells.map(shell => ({
      key: `shell:${shell.key}`,
      group: t('palette.groups.shells'),
      title: langText(shell.displayName) ?? shell.idShort ?? shell.id,
      subtitle: shell.id,
      icon: shell.assetKind === 'Type' ? 'mdi-shape-outline' : 'mdi-cube-outline',
      run: () => openShell(shell.key),
    }))
    // Elements of submodels that no shell references cannot be opened in the viewer.
    const elements = found.value.elements.filter(hit => hit.shellKey).map(hit => ({
      key: `element:${hit.submodelKey}:${hit.elementKey}`,
      group: t('palette.groups.elements'),
      title: hit.label,
      subtitle: [hit.shellLabel, hit.submodelLabel, hit.path].filter(Boolean).join(' › '),
      icon: modelTypeIcon(hit.modelType),
      run: () => openShell(hit.shellKey!, { submodel: hit.submodelKey, element: hit.elementKey }),
    }))
    items.push(...shells, ...elements, ...actions.value.filter(action => !needle || action.title.toLowerCase().includes(needle)))
    return items
  })

  let controller: AbortController | null = null
  let timer: ReturnType<typeof setTimeout> | undefined

  async function search (text: string) {
    controller?.abort()
    if (!props.targetId || text.length < 2) {
      found.value = { shells: [], elements: [] }
      searching.value = false
      return
    }
    controller = new AbortController()
    const signal = controller.signal
    searching.value = true
    error.value = null
    try {
      const result = await api<SearchResult>(`/targets/${props.targetId}/search`, { query: { q: text, limit: 6 }, signal })
      if (!signal.aborted) {
        found.value = result
      }
    } catch (error_) {
      if (!signal.aborted) {
        error.value = error_
        found.value = { shells: [], elements: [] }
      }
    } finally {
      if (!signal.aborted) {
        searching.value = false
      }
    }
  }

  async function lookup () {
    searching.value = true
    error.value = null
    try {
      const result = await api<{ items: ShellSummary[] }>(`/targets/${props.targetId}/lookup`, { query: { assetId: trimmed.value } })
      if (result.items.length === 1) {
        ui.commandOpen = false
        openShell(result.items[0]!.key)
        return
      }
      lookedUp.value = result.items
    } catch (error_) {
      error.value = error_
    } finally {
      searching.value = false
    }
  }

  watch(query, text => {
    cursor.value = 0
    lookedUp.value = null
    clearTimeout(timer)
    timer = setTimeout(() => void search(text.trim()), 300)
  })

  watch(() => ui.commandOpen, open => {
    if (open) {
      query.value = ''
      error.value = null
      found.value = { shells: [], elements: [] }
    }
  })

  function move (step: number) {
    const count = results.value.length
    if (count > 0) {
      cursor.value = (cursor.value + step + count) % count
    }
  }

  function run (item: PaletteItem | undefined) {
    if (!item) {
      return
    }
    // A lookup stays open to show its results.
    if (item.key !== 'lookup') {
      ui.commandOpen = false
    }
    void item.run()
  }

  onBeforeUnmount(() => {
    controller?.abort()
    clearTimeout(timer)
  })
</script>
