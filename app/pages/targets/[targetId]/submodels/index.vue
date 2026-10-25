<template>
  <div>
    <!-- The submodel list is the layout's (default.vue); the details drawer registers from here. -->

    <v-container>
      <ProblemAlert v-if="target.error.value" :error="target.error.value" retry @retry="target.refetch()" />

      <TargetAuthorization
        v-else-if="target.data.value && (target.needsAuthorization.value || authRequired)"
        :target="target.data.value"
        @authorized="invalidate(['targets', targetId])"
      />

      <v-skeleton-loader v-else-if="!target.data.value" type="card, article" />

      <!-- Reached by a link: this target serves submodels only through their shells. -->
      <v-empty-state
        v-else-if="!capabilities.submodelListSource"
        icon="mdi-file-tree-outline"
        :text="t('submodels.unsupportedText')"
        :title="t('submodels.unsupported')"
      >
        <template #actions>
          <v-btn-primary :text="t('nav.shells')" :to="`/targets/${targetId}/shells`" />
        </template>
      </v-empty-state>

      <!-- Nothing selected yet: the list beside it, or on phones behind a button. -->
      <v-container v-else-if="!submodelKey" class="fill-height" max-width="720">
        <v-empty-state :headline="t('submodels.headline')" :text="t('submodels.text')" :title="t('submodels.title')">
          <template #media>
            <v-avatar class="mb-4" color="primary" size="96" variant="tonal">
              <v-icon icon="mdi-file-tree-outline" size="48" />
            </v-avatar>
          </template>

          <template #actions>
            <v-btn-primary
              v-if="!mdAndUp"
              prepend-icon="mdi-format-list-bulleted"
              :text="t('submodels.browse')"
              @click="ui.listDrawer = true"
            />

            <v-btn prepend-icon="mdi-magnify" :text="t('viewer.search')" variant="tonal" @click="ui.commandOpen = true" />
          </template>
        </v-empty-state>
      </v-container>

      <ProblemAlert v-else-if="metadata.error.value" :error="metadata.error.value" retry @retry="metadata.refetch()" />

      <v-skeleton-loader v-else-if="!metadata.data.value" type="card, article" />

      <template v-else>
        <!-- Submodel header: title, meta line, actions and identifiers, then
             the shells that reference it (package editing plan, H1). -->
        <ResourceHeader :actions="headerActions" :identifiers="identifiers" :meta="headerMeta" :title="submodelLabel">
          <template #avatar="{ large }">
            <v-avatar
              class="me-1"
              :color="isTemplate ? 'warning' : 'primary'"
              :size="large ? 48 : 40"
              variant="tonal"
            >
              <v-icon :icon="modelTypeIcon('Submodel')" :size="large ? 28 : 24" />
            </v-avatar>
          </template>

          <!-- The shells that reference the submodel, each a link to it on the shell page. -->
          <v-divider />

          <div class="d-flex flex-wrap align-center ga-2 px-3 py-2 text-body-small">
            <span class="d-inline-flex align-center ga-2 text-medium-emphasis text-no-wrap me-1">
              <v-icon icon="$aas" size="16" />
              {{ t('submodels.referencedBy') }}
            </span>

            <v-progress-circular v-if="owners.isLoading.value" size="16" width="2" />

            <span v-else-if="owners.error.value" class="text-medium-emphasis">{{ t('submodels.ownersFailed') }}</span>

            <template v-else-if="owners.data.value">
              <v-chip
                v-for="shell in owningShells"
                :key="shell.key"
                prepend-icon="$aas"
                :text="langText(shell.displayName) ?? shell.idShort ?? shell.id"
                :to="{ path: `/targets/${targetId}/shells/${shell.key}`, query: { submodel: submodelKey, element: route.query.element } }"
              />

              <v-chip
                v-if="owningShells.length === 0"
                color="warning"
                prepend-icon="mdi-link-variant-off"
                :text="owners.data.value.complete ? t('submodels.orphan') : t('submodels.noOwnerFound')"
              />

              <!-- How the shells were found, where Studio read them one by one. -->
              <span v-if="owners.data.value.method === 'scan' && !target.data.value.workspace" class="text-medium-emphasis">
                {{ owners.data.value.complete ? t('submodels.scannedAll', { count: owners.data.value.scanned ?? 0 }) : t('submodels.scannedFirst', { count: owners.data.value.scanned ?? 0 }) }}
              </span>

              <v-btn
                v-if="canCreate"
                prepend-icon="mdi-plus"
                size="small"
                :text="t('submodels.addToShell')"
                @click="pickShellOpen = true"
              />
            </template>
          </div>
        </ResourceHeader>

        <ProblemAlert v-if="actionError" class="mb-4" :error="actionError" />

        <!-- The tabs head the content below, as on the shell page; the active
             tab's own actions sit at the end of the row (#shell-tab-actions). -->
        <div class="d-flex align-center border-b mb-4">
          <v-tabs v-model="tab" class="flex-grow-1 flex-shrink-1 overflow-hidden">
            <v-tab prepend-icon="mdi-file-tree-outline" :text="t('submodels.tabs.elements')" value="elements" />
            <v-tab prepend-icon="mdi-view-dashboard-variant-outline" :text="t('shell.tabs.overview')" value="overview" />
            <v-tab v-if="capabilities.changeFeed" prepend-icon="mdi-timeline-clock-outline" :text="t('shell.tabs.changes')" value="changes" />
            <v-tab prepend-icon="mdi-code-json" :text="t('shell.tabs.json')" value="json" />
          </v-tabs>

          <div id="shell-tab-actions" class="d-flex align-center flex-shrink-0 ga-1" />
        </div>

        <v-tabs-window v-model="tab">
          <!-- Eager: the card's dialogs serve the palette's structure actions on every tab. -->
          <v-tabs-window-item eager value="elements">
            <ElementTreeCard />
          </v-tabs-window-item>

          <v-tabs-window-item value="overview">
            <ShellOverview
              v-if="tab === 'overview'"
              :at="asOfIso"
              :overview-key="submodelOverviewKey(submodelKey)"
              :refresh-seconds="refreshSeconds"
              :refs="refs"
              :shell-id="null"
              :signals="liveSignals"
              :target="target.data.value"
              :unit-of="unitOf"
              @open="tree.openFromOverview"
              @select="tree.select"
            />
          </v-tabs-window-item>

          <v-tabs-window-item value="changes">
            <ShellChanges v-if="tab === 'changes'" :refs="refs" :shell-id="null" :target-id="targetId" />
          </v-tabs-window-item>

          <v-tabs-window-item value="json">
            <v-card height="600">
              <ProblemAlert
                v-if="full.error.value"
                class="ma-2"
                :error="full.error.value"
                retry
                @retry="full.refetch()"
              />

              <v-skeleton-loader v-else-if="!full.data.value" type="article" />
              <JsonPanel v-else :file-name="`${fileName}.json`" :label="t('submodels.jsonLabel')" :value="full.data.value.submodel" />
            </v-card>
          </v-tabs-window-item>
        </v-tabs-window>

        <ShellPickerDialog
          v-if="canCreate"
          v-model="pickShellOpen"
          :exclude="owningShells.map(shell => shell.id)"
          :target-id="targetId"
          :title="t('submodels.addToShellTitle', { name: submodelLabel })"
          @pick="addToShell"
        />

        <v-dialog v-model="confirmDelete" max-width="480">
          <DialogCard :title="t('submodels.deleteTitle', { name: submodelLabel })">
            <p class="text-body-medium mb-2">{{ t('submodels.deleteText') }}</p>

            <v-progress-linear v-if="owners.isLoading.value" class="my-2" />

            <template v-else-if="owningShells.length > 0">
              <v-alert class="mb-2" density="compact" :text="t('submodels.referencedWarning', owningShells.length)" type="warning" />

              <v-sheet
                border
                class="overflow-y-auto"
                color="transparent"
                max-height="200"
                rounded="lg"
              >
                <v-list>
                  <v-list-subheader>{{ t('submodels.referencingShells') }}</v-list-subheader>

                  <v-list-item
                    v-for="shell in owningShells"
                    :key="shell.key"
                    prepend-icon="$aas"
                    :subtitle="shell.id"
                    :title="langText(shell.displayName) ?? shell.idShort ?? shell.id"
                  />
                </v-list>
              </v-sheet>

              <v-checkbox v-model="removeReferences" class="mt-2" :label="t('submodels.removeReferences', owningShells.length)" />
            </template>

            <v-alert
              v-if="owners.data.value && !owners.data.value.complete"
              class="mt-2"
              density="compact"
              :text="t('submodels.ownersIncomplete', { count: owners.data.value.scanned ?? 0 })"
              type="info"
            />

            <template #actions>
              <v-btn :text="t('common.cancel')" @click="confirmDelete = false" />
              <v-btn-primary color="error" :loading="deleting" :text="t('submodels.delete')" @click="remove" />
            </template>
          </DialogCard>
        </v-dialog>
      </template>
    </v-container>

    <ElementDetailsDrawer
      v-if="target.data.value && submodelKey && metadata.data.value"
      v-model:mode="detailsMode"
      v-model:view="detailsView"
      :at="asOfIso"
      :can-invoke="canInvoke"
      :can-write="canWrite"
      :capabilities="capabilities"
      :creating="creating"
      :history="selectedHistory"
      :item="selectedItem"
      :overview-key="submodelOverviewKey(submodelKey)"
      :refreshing="Boolean(refreshSeconds)"
      :shell-id="null"
      :submodel-label="selectedSubmodelLabel"
      :submodel-ref="selectedRef"
      :target="target.data.value"
      @cancel-create="creating = null"
      @changed="onElementChanged"
      @created="tree.onCreated"
      @select="tree.select"
    />
  </div>
</template>

<script lang="ts" setup>
  import type { DeleteResult, ElementDetail, ShellSummary, SubmodelDetail, SubmodelOwners, SubmodelRef, TargetCapabilities } from '#shared/contract'
  import type { HeaderAction } from '~/utils/resource-header'
  import { useQuery } from '@pinia/colada'
  import { useDisplay } from 'vuetify'
  import { semanticLabel } from '#shared/aas/semantic-label'
  import { noCapabilities } from '#shared/contract'
  import { provideElementTree, useElementTree } from '~/composables/useElementTree'
  import { submodelOverviewKey } from '~/composables/useShellOverview'
  import { StudioApiError } from '~/composables/useStudioApi'
  import { langText, modelTypeIcon } from '~/utils/aas'

  // The submodel view (submodel-centric browsing): a submodel on its own,
  // chosen in the layout's list, with the shell page's tree, tabs, details
  // drawer and edit-mode actions. Selection and tabs use the shell page's
  // query parameters (`submodel`, `element`, `mode`, `tab`).
  const { t } = useI18n()
  const route = useRoute()
  const router = useRouter()
  const api = useStudioApi()
  const studioUrl = useStudioUrl()
  const invalidate = useInvalidate()
  const ui = useUiStore()
  const preferences = usePreferences()
  const notifications = useNotificationsStore()
  const { mdAndUp } = useDisplay()

  const targetId = computed(() => String(route.params.targetId))
  const submodelKey = computed(() => typeof route.query.submodel === 'string' ? route.query.submodel : null)
  const target = useTarget(targetId)
  const capabilities = computed<TargetCapabilities>(() => target.data.value?.capabilities ?? noCapabilities)
  const ready = () => target.data.value !== undefined && !target.needsAuthorization.value && Boolean(capabilities.value.submodelListSource) && submodelKey.value !== null

  const metadata = useQuery({
    key: () => ['targets', targetId.value, 'submodels', submodelKey.value ?? ''],
    query: ({ signal }) => api<SubmodelDetail>(`/targets/${targetId.value}/submodels/${submodelKey.value}`, { signal }),
    enabled: ready,
  })
  const owners = useQuery({
    key: () => ['targets', targetId.value, 'submodels', submodelKey.value ?? '', 'shells'],
    query: ({ signal }) => api<SubmodelOwners>(`/targets/${targetId.value}/submodels/${submodelKey.value}/shells`, { signal }),
    enabled: ready,
  })
  const owningShells = computed<ShellSummary[]>(() => owners.data.value?.items[0]?.shells ?? [])

  const submodelJson = computed(() => (metadata.data.value?.submodel ?? {}) as Record<string, any>)
  const submodelId = computed(() => String(submodelJson.value.id ?? ''))
  const submodelLabel = computed(() => langText(submodelJson.value.displayName ?? [], preferences.preferences.value.valueLanguage) ?? submodelJson.value.idShort ?? submodelId.value)
  const fileName = computed(() => String(submodelJson.value.idShort ?? 'submodel').replaceAll(/[^\w-]/g, '_'))
  const isTemplate = computed(() => submodelJson.value.kind === 'Template')
  const semanticId = computed(() => (submodelJson.value.semanticId?.keys?.[0]?.value as string | undefined) ?? null)
  const administration = computed(() => {
    const value = (submodelJson.value.administration ?? {}) as Record<string, unknown>
    const text = (field: string) => typeof value[field] === 'string' && value[field] !== '' ? value[field] as string : null
    return { version: text('version'), revision: text('revision'), templateId: text('templateId') }
  })

  // The tree shows the one submodel, as a shell's tree shows its references.
  const refs = computed<SubmodelRef[]>(() => metadata.data.value && submodelKey.value
    ? [{
      key: submodelKey.value,
      submodelId: submodelId.value,
      idShort: typeof submodelJson.value.idShort === 'string' ? submodelJson.value.idShort : null,
      semanticId: semanticId.value,
      kind: typeof submodelJson.value.kind === 'string' ? submodelJson.value.kind : null,
      administration: administration.value,
      status: 'available',
    }]
    : [])

  /** The muted line under the title: idShort, kind, template, target. */
  const headerMeta = computed(() => {
    const template = semanticId.value ? semanticLabel(semanticId.value, submodelJson.value.idShort, administration.value) : null
    return [
      ...(submodelJson.value.idShort && submodelJson.value.idShort !== submodelLabel.value ? [{ text: String(submodelJson.value.idShort), icon: modelTypeIcon('Submodel'), class: undefined }] : []),
      { text: t(`editor.kinds.${isTemplate.value ? 'Template' : 'Instance'}`), icon: 'mdi-shape-outline', class: isTemplate.value ? 'text-warning' : undefined },
      ...(template ? [{ text: template, icon: 'mdi-file-certificate-outline', class: undefined }] : []),
      ...(target.data.value ? [{ text: target.data.value.name, icon: target.data.value.workspace ? 'mdi-package-variant-closed' : 'mdi-server-network', class: undefined }] : []),
    ]
  })

  const identifiers = computed(() => [
    { label: t('submodels.identifier'), value: submodelId.value, icon: 'mdi-identifier' },
    ...(semanticId.value ? [{ label: t('submodels.semanticId'), value: semanticId.value, icon: 'mdi-tag-outline' }] : []),
    ...(administration.value.templateId ? [{ label: t('submodels.templateId'), value: administration.value.templateId, icon: 'mdi-file-certificate-outline' }] : []),
  ])

  const exportFormats = computed(() => [
    { value: 'json', title: t('shell.formats.json'), subtitle: '.json', icon: 'mdi-code-json', href: studioUrl.api(`/targets/${targetId.value}/submodels/${submodelKey.value}?content=full&download=true`) },
    { value: 'xml', title: t('shell.formats.xml'), subtitle: '.xml', icon: 'mdi-xml', href: studioUrl.api(`/targets/${targetId.value}/submodels/${submodelKey.value}?content=full&format=xml`) },
  ])

  // The tree, the selection and structure editing, shared with the shell
  // page. Rights are granted per shell (D15); for a submodel on its own the
  // target decides when it is written.
  const tree = useElementTree({
    targetId: () => targetId.value,
    target: () => target.data.value,
    refs: () => refs.value,
    can: () => true,
    onResourcesChanged: () => afterChange(),
    subject: () => submodelKey.value,
  })
  provideElementTree(tree)
  const {
    canWrite,
    canCreate,
    canEditStructure,
    canInvoke,
    asOfIso,
    refreshSeconds,
    liveSignals,
    unitOf,
    selectedItem,
    selectedSubmodelLabel,
    selectedRef,
    selectedHistory,
    detailsMode,
    detailsView,
    creating,
    actionError,
    convertTarget,
  } = tree
  const canEdit = computed(() => canWrite.value || canEditStructure.value)
  /** The submodel's row of the tree, for the conversion dialog. */
  const submodelItem = computed(() => submodelKey.value ? tree.trees.lookup(submodelKey.value) : null)

  // The header's actions, by how long they stay inline (H3).
  const headerActions = computed<HeaderAction[]>(() => [
    ...(canEdit.value ? [{ id: 'edit', title: t('submodels.edit'), icon: 'mdi-pencil-outline', rank: 1, onClick: () => tree.select(submodelKey.value) }] : []),
    ...(canCreate.value && isTemplate.value ? [{ id: 'convert', title: t('edit.convert'), icon: 'mdi-file-replace-outline', rank: 3, onClick: () => (convertTarget.value = submodelItem.value) }] : []),
    { id: 'export', title: t('shell.export'), icon: 'mdi-download', rank: 2, primary: true, items: exportFormats.value },
    ...(canCreate.value ? [{ id: 'add-to-shell', title: t('submodels.addToShell'), icon: 'mdi-link-variant-plus', rank: 4, menuOnly: true, onClick: () => (pickShellOpen.value = true) }] : []),
    ...(canCreate.value ? [{ id: 'delete', title: t('submodels.delete'), icon: 'mdi-delete-outline', rank: 5, danger: true, onClick: openDelete }] : []),
  ])

  const tab = computed({
    get: () => {
      const value = typeof route.query.tab === 'string' ? route.query.tab : 'elements'
      return value === 'changes' && !capabilities.value.changeFeed ? 'elements' : value
    },
    set: (value: string) => router.replace({ query: { ...route.query, tab: value === 'elements' ? undefined : value } }),
  })
  tree.followTabs(() => tab.value, 'elements')

  const full = useQuery({
    key: () => ['targets', targetId.value, 'submodels', submodelKey.value ?? '', 'full', asOfIso.value ?? ''],
    query: ({ signal }) => api<SubmodelDetail>(`/targets/${targetId.value}/submodels/${submodelKey.value}`, { query: { content: 'full', at: asOfIso.value ?? undefined }, signal }),
    enabled: () => ready() && tab.value === 'json',
  })

  // Another submodel starts with its tree closed and no details open, unless the link names an element.
  watch([targetId, submodelKey], () => {
    tree.resetView()
    if (typeof route.query.element !== 'string') {
      ui.detailsDrawer = false
    }
  })

  /** The submodel or its references changed: the header, the list and the tree are read again. */
  async function afterChange () {
    await invalidate(['targets', targetId.value])
    await tree.trees.reload()
  }
  // Undo and redo are the package bar's (package editing plan, H5).
  onWorkspaceRestored(() => targetId.value, afterChange)

  async function onElementChanged (detail: ElementDetail) {
    await tree.onElementChanged(detail)
    // Names in the header and the list follow the submodel's metadata.
    if (selectedItem.value?.elementKey === null) {
      await invalidate(['targets', targetId.value, 'submodels'])
    }
  }

  const pickShellOpen = ref(false)
  async function addToShell (shell: ShellSummary) {
    await tree.guard(async () => {
      await api(`/targets/${targetId.value}/shells/${shell.key}/submodel-refs`, { method: 'POST', body: { submodel: { source: 'existing', id: submodelId.value } } })
      notifications.notify({ text: t('submodels.addedToShell', { name: langText(shell.displayName) ?? shell.idShort ?? shell.id }), color: 'success' })
      await invalidate(['targets', targetId.value])
    })
  }

  const confirmDelete = ref(false)
  const removeReferences = ref(true)
  const deleting = ref(false)

  function openDelete () {
    removeReferences.value = true
    confirmDelete.value = true
    void owners.refetch()
  }

  async function remove () {
    deleting.value = true
    actionError.value = null
    try {
      const result = await api<DeleteResult>(`/targets/${targetId.value}/submodels/${submodelKey.value}`, {
        method: 'DELETE',
        // The server finds the references itself, also when the preview is loading or failed.
        query: { removeReferences: String(removeReferences.value) },
      })
      confirmDelete.value = false
      const failed = result.sync.filter(step => step.outcome === 'failed').length
      notifications.notify(failed > 0
        ? { text: t('shell.deletedSyncFailed', { name: submodelLabel.value, count: failed }), color: 'warning' }
        : { text: t('submodels.deleted', { name: submodelLabel.value }), color: 'success' })
      ui.detailsDrawer = false
      await router.replace({ query: { ...route.query, submodel: undefined, element: undefined, mode: undefined, view: undefined, tab: undefined } })
      await invalidate(['targets', targetId.value])
    } catch (error) {
      confirmDelete.value = false
      actionError.value = error
    } finally {
      deleting.value = false
    }
  }

  const authRequired = computed(() => [metadata.error.value, owners.error.value]
    .some(error => error instanceof StudioApiError && error.code === 'target_auth_required'))
</script>
