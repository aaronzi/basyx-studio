<template>
  <!-- One open package in the grouped list: its header with the unsaved
       marker and the package's actions, then its rows while expanded. -->
  <v-list-item
    :active="current && !open"
    :aria-expanded="open"
    class="mt-1"
    lines="one"
    :title="target.name"
    @click="groups.toggle(target.id, current)"
  >
    <template #prepend>
      <v-icon :icon="open ? 'mdi-chevron-down' : 'mdi-chevron-right'" />
      <v-icon class="ms-1" icon="mdi-package-variant-closed" />
    </template>

    <template #append>
      <v-icon
        v-if="target.workspace?.unsavedChanges"
        v-tooltip="t('workspace.unsaved')"
        :aria-label="t('workspace.unsaved')"
        color="warning"
        icon="mdi-circle-medium"
      />

      <v-menu>
        <template #activator="{ props: activator }">
          <v-btn
            v-bind="activator"
            :aria-label="t('workspace.moreNamed', { name: target.name })"
            icon="mdi-dots-vertical"
            size="small"
            @click.stop
          />
        </template>

        <v-list>
          <v-list-item
            :disabled="!target.workspace?.unsavedChanges || actions.busy.value !== null"
            prepend-icon="mdi-content-save-outline"
            :title="t('workspace.save')"
            @click="actions.save()"
          />

          <v-list-item
            v-if="actions.bridge.value"
            :disabled="actions.busy.value !== null"
            prepend-icon="mdi-content-save-edit-outline"
            :title="t('workspace.saveAs')"
            @click="actions.saveAs()"
          />

          <v-divider class="my-1" />

          <v-list-item
            :disabled="actions.busy.value !== null"
            prepend-icon="mdi-close"
            :title="t('workspace.close')"
            @click="actions.close(false)"
          />
        </v-list>
      </v-menu>
    </template>
  </v-list-item>

  <template v-if="open">
    <v-skeleton-loader v-if="list.isLoading.value && rows.length === 0" type="list-item-two-line@2" />

    <v-list-item
      v-for="row in rows"
      :key="row.key"
      :active="row.key === activeKey"
      :subtitle="row.id"
      :title="row.title"
      :to="row.to"
      @click="onOpen"
    >
      <template #prepend>
        <ShellAvatar
          v-if="row.shell"
          :shell="row.shell"
          size="36"
          :target-id="target.id"
          :thumbnails="target.capabilities.files"
        />

        <v-avatar v-else :color="row.marker ? 'warning' : 'primary'" size="36" variant="tonal">
          <v-icon :icon="modelTypeIcon('Submodel')" />
        </v-avatar>
      </template>

      <template v-if="row.marker" #append>
        <v-chip class="me-1" color="warning" size="x-small" :text="row.marker" />
      </template>
    </v-list-item>

    <v-list-item
      v-if="list.hasNextPage.value"
      :disabled="loadingMore"
      lines="one"
      prepend-icon="mdi-chevron-down"
      :title="kind === 'shells' ? t('shells.loadMore') : t('submodels.loadMore')"
      @click="loadMore"
    />

    <v-list-item
      v-else-if="list.data.value && rows.length === 0"
      class="text-medium-emphasis"
      lines="one"
      :title="emptyText"
    />
  </template>

  <v-dialog v-model="actions.confirmClose.value" max-width="480">
    <DialogCard :title="t('workspace.closeTitle', { name: target.name })">
      {{ t('workspace.closeText') }}

      <template #actions>
        <v-btn :text="t('workspace.cancel')" @click="actions.confirmClose.value = false" />
        <v-btn-primary color="error" :text="t('workspace.closeWithoutSaving')" @click="actions.close(true)" />
      </template>
    </DialogCard>
  </v-dialog>
</template>

<script lang="ts" setup>
  import type { Page, ShellSummary, SubmodelSummary, Target } from '#shared/contract'
  import type { LocationQueryRaw, RouteLocationRaw } from 'vue-router'
  import { useInfiniteQuery } from '@pinia/colada'
  import { useDisplay } from 'vuetify'
  import { langText, modelTypeIcon } from '~/utils/aas'

  const props = defineProps<{
    kind: 'shells' | 'submodels'
    target: Target
    /** The package the page shows. */
    current: boolean
    activeKey: string | null
    expression: string
    kindFilter: string
    searchState: LocationQueryRaw
  }>()

  const { t } = useI18n()
  const api = useStudioApi()
  const ui = useUiStore()
  const { mobile } = useDisplay()
  const groups = usePackageGroupState()
  const actions = useWorkspaceActions(() => props.target)
  const open = computed(() => groups.isOpen(props.target.id, props.current))
  watch(() => props.current, current => current && groups.remember(props.target.id), { immediate: true })

  // Packages evaluate search expressions themselves (`search: 'expression'`).
  // The shells' kind is part of the expression, as in the shell list; the
  // submodels' kind is filtered here, as the query language has no field for it.
  const expression = computed(() => {
    const kind = props.kind === 'shells' && props.kindFilter !== 'all' ? `assetKind=${props.kindFilter}` : ''
    return [props.expression, kind].filter(Boolean).join(' ')
  })
  const mounted = ref(false)
  onMounted(() => (mounted.value = true))

  type Summary = ShellSummary | SubmodelSummary
  interface Row {
    key: string
    id: string
    title: string
    /** The shell of a shell row, for its avatar. */
    shell: ShellSummary | null
    marker: string | null
    to: RouteLocationRaw
  }
  const list = useInfiniteQuery({
    key: () => expression.value
      ? ['targets', props.target.id, props.kind, 'search', expression.value]
      : ['targets', props.target.id, props.kind],
    query: ({ pageParam, signal }) => expression.value
      ? api<Page<Summary>>(`/targets/${props.target.id}/searches`, {
        method: 'POST',
        body: { scope: props.kind, expression: expression.value, limit: 100, cursor: pageParam ?? undefined },
        signal,
      })
      : api<Page<Summary>>(`/targets/${props.target.id}/${props.kind}`, { query: { limit: 100, cursor: pageParam ?? undefined }, signal }),
    initialPageParam: null as string | null,
    getNextPageParam: lastPage => lastPage.page.nextCursor,
    // Searches are POST requests, which only the browser can make.
    enabled: () => open.value && mounted.value,
  })

  const rows = computed<Row[]>(() => (list.data.value?.pages.flatMap(page => page.items) ?? []).flatMap((item): Row[] => {
    const title = langText(item.displayName) ?? item.idShort ?? item.id
    if (props.kind === 'shells') {
      const shell = item as ShellSummary
      return [{
        key: shell.key,
        id: shell.id,
        title,
        shell,
        marker: shell.assetKind === 'Type' ? t('shells.type') : null,
        to: { path: `/targets/${props.target.id}/shells/${shell.key}`, query: props.searchState },
      }]
    }
    const submodel = item as SubmodelSummary
    if (props.kindFilter !== 'all' && submodel.kind !== props.kindFilter) {
      return []
    }
    return [{
      key: submodel.key,
      id: submodel.id,
      title,
      shell: null,
      marker: submodel.kind === 'Template' ? t('submodels.template') : null,
      to: { path: `/targets/${props.target.id}/submodels`, query: { ...props.searchState, submodel: submodel.key } },
    }]
  }))

  const emptyText = computed(() => {
    const filtered = expression.value !== '' || props.kindFilter !== 'all'
    if (props.kind === 'shells') {
      return filtered ? t('shells.none') : t('shells.empty')
    }
    return filtered ? t('submodels.none') : t('submodels.empty')
  })

  const loadingMore = ref(false)
  async function loadMore () {
    loadingMore.value = true
    try {
      await list.loadNextPage()
    } finally {
      loadingMore.value = false
    }
  }

  function onOpen () {
    if (mobile.value) {
      ui.listDrawer = false
    }
  }
</script>
