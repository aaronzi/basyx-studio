<template>
  <div>
    <!-- The shell list is the layout's (default.vue); the details drawer registers from here. -->

    <v-container>
      <ProblemAlert v-if="target.error.value" :error="target.error.value" retry @retry="target.refetch()" />

      <TargetAuthorization
        v-else-if="target.data.value && (target.needsAuthorization.value || authRequired)"
        :target="target.data.value"
        @authorized="onAuthorized"
      />

      <ProblemAlert v-else-if="shell.error.value" :error="shell.error.value" retry @retry="shell.refetch()" />

      <v-skeleton-loader v-else-if="!shell.data.value || !target.data.value" type="card, article" />

      <template v-else>
        <!-- Shell header: title, meta line, actions and identifiers, with the
             global asset ID as a QR code (package editing plan, H1). -->
        <ResourceHeader :actions="headerActions" :identifiers="identifiers" :meta="headerMeta" :title="shellLabel">
          <template #avatar="{ large }">
            <ShellAvatar
              class="me-1"
              :icon-size="large ? 28 : 24"
              :shell="{ key: shellKey, idShort: shellJson.idShort ?? null, assetKind, thumbnail: hasThumbnail, thumbnailUrl }"
              :size="large ? 48 : 40"
              :target-id="targetId"
              :thumbnails="capabilities.files"
            />
          </template>

          <template v-if="globalAssetId" #identifiers-append>
            <v-btn
              v-tooltip="t('qr.show')"
              :aria-label="t('qr.show')"
              class="pa-1 flex-shrink-0"
              height="72"
              min-width="0"
              width="72"
              @click="qrOpen = true"
            >
              <v-img :alt="t('qr.alt', { id: globalAssetId })" :src="qrPreview" width="64" />
            </v-btn>
          </template>
        </ResourceHeader>

        <ProblemAlert v-if="actionError" class="mb-4" :error="actionError" />

        <!-- The tabs head the content below: their line spans the content's
             width and the active tab sits on it, so they read as one block.
             The active tab's own actions sit at the end of the row
             (#shell-tab-actions, e.g. the Overview's widgets). -->
        <div class="d-flex align-center border-b mb-4">
          <v-tabs v-model="tab" class="flex-grow-1 flex-shrink-1 overflow-hidden">
            <v-tab prepend-icon="mdi-file-tree-outline" :text="t('shell.tabs.submodels')" value="submodels" />
            <v-tab prepend-icon="mdi-view-dashboard-variant-outline" :text="t('shell.tabs.overview')" value="overview" />
            <v-tab v-if="capabilities.changeFeed" prepend-icon="mdi-timeline-clock-outline" :text="t('shell.tabs.changes')" value="changes" />
            <v-tab prepend-icon="mdi-code-json" :text="t('shell.tabs.json')" value="json" />
          </v-tabs>

          <div id="shell-tab-actions" class="d-flex align-center flex-shrink-0 ga-1" />
        </div>

        <v-tabs-window v-model="tab">
          <!-- Eager: the card's dialogs serve the palette's structure actions on every tab. -->
          <v-tabs-window-item eager value="submodels">
            <ElementTreeCard
              :empty="Boolean(refs.data.value) && submodelRefs.length === 0"
              :empty-text="t('shell.noSubmodels')"
              :refs-error="refs.error.value"
              :refs-loading="refs.isLoading.value"
              @retry="refs.refetch()"
            >
              <!-- Submodels of this shell: new, pasted, from text or a file (A1). -->
              <template #toolbar>
                <AddMenu
                  v-if="canEditShell"
                  compact
                  importable
                  kind="submodel"
                  :label="t('copies.add.submodel')"
                  :new-items="[{ title: t('wizard.addSubmodel'), icon: 'mdi-plus', onClick: () => (addSubmodelOpen = true) }]"
                  :paste-label="pastedSubmodel?.label ?? null"
                  @import="ui.openUpload(null, shellKey)"
                  @paste="pasteSubmodel"
                  @text="textOpen = true"
                />
              </template>

              <template #submodel-actions="{ item }">
                <v-list-item
                  v-if="capabilities.submodelListSource"
                  prepend-icon="mdi-file-tree-outline"
                  :title="t('edit.openInSubmodels')"
                  :to="{ path: `/targets/${targetId}/submodels`, query: { submodel: item.submodelKey } }"
                />

                <v-list-item base-color="error" prepend-icon="mdi-file-remove-outline" :title="t('edit.removeSubmodel')" @click="removeSubmodelTarget = item" />
              </template>
            </ElementTreeCard>
          </v-tabs-window-item>

          <v-tabs-window-item value="overview">
            <ShellOverview
              v-if="tab === 'overview'"
              :at="asOfIso"
              :overview-key="shellKey"
              :refresh-seconds="refreshSeconds"
              :refs="submodelRefs"
              :shell-id="shellId"
              :signals="liveSignals"
              :target="target.data.value"
              :unit-of="unitOf"
              @open="tree.openFromOverview"
              @select="tree.select"
            />
          </v-tabs-window-item>

          <v-tabs-window-item value="changes">
            <ShellChanges
              v-if="tab === 'changes'"
              :refs="submodelRefs"
              :shell-id="shellId"
              :shell-label="shellLabel"
              :target-id="targetId"
            />
          </v-tabs-window-item>

          <v-tabs-window-item value="json">
            <v-card height="600">
              <JsonPanel :file-name="jsonFileName" :label="t('shell.jsonLabel')" :value="shellJson" />
            </v-card>
          </v-tabs-window-item>
        </v-tabs-window>

        <AasTextDialog
          v-if="canEditShell"
          v-model="textOpen"
          :destination-shell-key="shellKey"
          kind="submodel"
          :target-id="targetId"
          :title="t('copies.text.title.submodel')"
        />

        <AssetQrDialog v-if="globalAssetId" v-model="qrOpen" :content="globalAssetId" :file-name="shellJson.idShort ?? 'asset'" />

        <ShareDialog
          v-if="canShare"
          v-model="shareOpen"
          :shell-key="shellKey"
          :shell-label="shellLabel"
          :target-id="targetId"
        />

        <v-dialog max-width="480" :model-value="removeSubmodelTarget !== null" @update:model-value="open => { if (!open) removeSubmodelTarget = null }">
          <DialogCard :title="t('edit.removeSubmodelTitle', { name: removeSubmodelTarget?.title ?? '' })">
            {{ t('edit.removeSubmodelText') }}

            <v-checkbox v-model="alsoDelete" class="mt-2" :label="t('edit.alsoDelete')" />

            <template #actions>
              <v-btn :text="t('common.cancel')" @click="removeSubmodelTarget = null" />
              <v-btn-primary color="error" :loading="removingSubmodel" :text="t('edit.removeSubmodel')" @click="removeSubmodel" />
            </template>
          </DialogCard>
        </v-dialog>

        <SubmodelAddDialog v-model="addSubmodelOpen" :shell-key="shellKey" :target-id="targetId" @added="afterShellChange" />

        <InstanceDialog
          v-model="instanceOpen"
          :name="shellLabel"
          :shell-key="shellKey"
          :target-id="targetId"
          @created="onInstanceCreated"
        />

        <v-dialog v-model="confirmDelete" max-width="420">
          <DialogCard :title="t('shell.deleteTitle')">
            <p class="text-body-medium mb-2">{{ t('shell.deleteText', { name: shellLabel }) }}</p>

            <template v-if="submodelRefs.length > 0">
              <v-checkbox v-model="alsoDeleteSubmodels" :label="t('shell.alsoDeleteSubmodels', submodelRefs.length)" />

              <v-expand-transition>
                <v-sheet
                  v-if="alsoDeleteSubmodels"
                  border
                  class="overflow-y-auto"
                  color="transparent"
                  max-height="200"
                  rounded="lg"
                >
                  <v-list>
                    <v-list-subheader>{{ t('shell.affectedSubmodels') }}</v-list-subheader>

                    <v-list-item
                      v-for="submodelRef in submodelRefs"
                      :key="submodelRef.key"
                      prepend-icon="mdi-file-tree-outline"
                      :subtitle="submodelRef.submodelId"
                      :title="submodelRef.idShort ?? submodelRef.submodelId"
                    />
                  </v-list>
                </v-sheet>
              </v-expand-transition>

              <v-alert
                v-if="alsoDeleteSubmodels"
                class="mt-3"
                density="compact"
                :text="t('shell.sharedWarning')"
                type="warning"
              />
            </template>

            <template #actions>
              <v-btn :text="t('common.cancel')" @click="confirmDelete = false" />
              <v-btn-primary color="error" :loading="deleting" :text="t('shell.delete')" @click="remove" />
            </template>
          </DialogCard>
        </v-dialog>
      </template>
    </v-container>

    <ElementDetailsDrawer
      v-if="target.data.value && shell.data.value"
      v-model:mode="detailsMode"
      v-model:view="detailsView"
      :at="asOfIso"
      :can-invoke="canInvoke"
      :can-write="canWrite"
      :capabilities="capabilities"
      :creating="creating"
      :editing-shell="editingShell"
      :history="selectedHistory"
      :item="selectedItem"
      :overview-key="shellKey"
      :refreshing="Boolean(refreshSeconds)"
      :shell-detail="shell.data.value"
      :shell-id="shellId"
      :submodel-label="selectedSubmodelLabel"
      :submodel-ref="selectedRef"
      :target="target.data.value"
      @cancel-create="creating = null"
      @changed="tree.onElementChanged"
      @close-shell="editingShell = false"
      @created="tree.onCreated"
      @select="tree.select"
      @shell-changed="onShellChanged"
    />
  </div>
</template>

<script lang="ts" setup>
  import type { DeleteResult, EffectiveRights, ShellCreateResult, ShellDetail, SubmodelRef, TargetCapabilities } from '#shared/contract'
  import type { ShellTreeItem } from '~/composables/useShellTrees'
  import type { HeaderAction } from '~/utils/resource-header'
  import { useQuery, useQueryCache } from '@pinia/colada'
  import { noCapabilities } from '#shared/contract'
  import { provideElementTree, useElementTree } from '~/composables/useElementTree'
  import { StudioApiError } from '~/composables/useStudioApi'
  import { langText } from '~/utils/aas'
  import { identificationLinkSvg, svgDataUrl } from '~/utils/qr'

  const { t } = useI18n()
  const route = useRoute()
  const router = useRouter()
  const api = useStudioApi()
  const studioUrl = useStudioUrl()
  const invalidate = useInvalidate()
  const queryCache = useQueryCache()
  const ui = useUiStore()
  const preferences = usePreferences()
  const notifications = useNotificationsStore()

  const targetId = computed(() => String(route.params.targetId))
  const shellKey = computed(() => String(route.params.shellKey))
  const target = useTarget(targetId)
  const ready = () => target.data.value !== undefined && !target.needsAuthorization.value

  const shell = useQuery({
    key: () => ['targets', targetId.value, 'shells', shellKey.value],
    query: ({ signal }) => api<ShellDetail>(`/targets/${targetId.value}/shells/${shellKey.value}`, { signal }),
    enabled: ready,
  })

  const refs = useQuery({
    key: () => ['targets', targetId.value, 'shells', shellKey.value, 'submodel-refs'],
    query: ({ signal }) => api<{ items: SubmodelRef[] }>(`/targets/${targetId.value}/shells/${shellKey.value}/submodel-refs`, { signal }),
    enabled: ready,
  })

  const capabilities = computed<TargetCapabilities>(() => target.data.value?.capabilities ?? noCapabilities)
  const rights = useQuery({
    key: () => ['targets', targetId.value, 'shells', shellKey.value, 'rights'],
    query: ({ signal }) => api<EffectiveRights>(`/targets/${targetId.value}/shells/${shellKey.value}/rights`, { signal }),
    enabled: () => ready() && Boolean(target.data.value?.capabilities.sharing),
  })
  const can = (action: keyof EffectiveRights) => !capabilities.value.sharing || (rights.data.value?.[action] ?? false)

  const shellJson = computed(() => (shell.data.value?.shell ?? {}) as Record<string, any>)
  const shellId = computed(() => String(shellJson.value.id ?? ''))
  const jsonFileName = computed(() => `${String(shellJson.value.idShort ?? 'shell').replaceAll(/[^\w-]/g, '_')}.json`)
  const shellLabel = computed(() => langText(shellJson.value.displayName ?? [], preferences.preferences.value.valueLanguage) ?? shellJson.value.idShort ?? shellId.value)
  const assetKind = computed(() => (shellJson.value.assetInformation?.assetKind as string | undefined) ?? null)
  const assetType = computed(() => (shellJson.value.assetInformation?.assetType as string | undefined) ?? null)
  // The idShort only when the title is a display name, so nothing repeats.
  /** The muted line under the title: idShort, kind, submodels, target. */
  const headerMeta = computed(() => [
    ...(shellJson.value.idShort && shellJson.value.idShort !== shellLabel.value ? [{ text: String(shellJson.value.idShort), icon: '$aas', class: undefined }] : []),
    ...(assetKind.value ? [{ text: t('shell.assetKind', { kind: assetKind.value }), icon: 'mdi-shape-outline', class: assetKind.value === 'Type' ? 'text-warning' : undefined }] : []),
    { text: t('shell.submodelCount', submodelRefs.value.length), icon: 'mdi-folder-multiple-outline', class: undefined },
    ...(target.data.value ? [{ text: target.data.value.name, icon: target.data.value.workspace ? 'mdi-package-variant-closed' : 'mdi-server-network', class: undefined }] : []),
  ])
  const thumbnailUrl = computed(() => {
    const path = shellJson.value.assetInformation?.defaultThumbnail?.path
    return typeof path === 'string' && /^https?:\/\//i.test(path) ? path : null
  })
  const hasThumbnail = computed(() => typeof shellJson.value.assetInformation?.defaultThumbnail?.path === 'string')
  const submodelRefs = computed(() => refs.data.value?.items ?? [])

  const identifiers = computed(() => [
    { label: t('shell.identifier'), value: shellId.value, icon: 'mdi-identifier' },
    ...(shellJson.value.assetInformation?.globalAssetId
      ? [{ label: t('shell.globalAssetId'), value: String(shellJson.value.assetInformation.globalAssetId), icon: 'mdi-barcode' }]
      : []),
    ...(assetType.value ? [{ label: t('shell.assetType'), value: assetType.value, icon: 'mdi-tag-outline' }] : []),
  ])

  // The submodels' tree, the selection and structure editing, shared with the submodel view.
  const editingShell = ref(false)
  const tree = useElementTree({
    targetId: () => targetId.value,
    target: () => target.data.value,
    refs: () => submodelRefs.value,
    can,
    onResourcesChanged: () => afterShellChange(),
    beforeSelect: () => (editingShell.value = false),
  })
  provideElementTree(tree)
  const {
    canWrite,
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
  } = tree

  // In view mode nothing can be changed (plan D8); with sharing, the user's rights decide (D15).
  // Structure actions need the target to accept structural writes (MVP-5 plan, P1).
  const canEditShell = tree.canCreate
  const canDelete = computed(() => ui.editing && capabilities.value.deleteShells && can('delete'))
  const canShare = computed(() => capabilities.value.sharing && can('manage'))

  const exportFormats = computed(() => [
    { value: 'aasx', title: t('shell.formats.aasx'), subtitle: '.aasx', icon: 'mdi-package-variant-closed' },
    { value: 'json', title: t('shell.formats.json'), subtitle: '.json', icon: 'mdi-code-json' },
    { value: 'xml', title: t('shell.formats.xml'), subtitle: '.xml', icon: 'mdi-xml' },
  ])

  const tab = computed({
    get: () => {
      const value = typeof route.query.tab === 'string' ? route.query.tab : 'submodels'
      return value === 'changes' && !capabilities.value.changeFeed ? 'submodels' : value
    },
    set: (value: string) => router.replace({ query: { ...route.query, tab: value === 'submodels' ? undefined : value } }),
  })
  tree.followTabs(() => tab.value, 'submodels')

  watch([targetId, shellKey], () => tree.resetView())
  // Remembered once the shell is loaded, with the title the user saw.
  watch(() => shell.data.value?.key, key => {
    if (key) {
      void preferences.rememberShell(targetId.value, key, shellLabel.value)
    }
  }, { immediate: true })

  const addSubmodelOpen = ref(false)
  const instanceOpen = ref(false)
  const removeSubmodelTarget = ref<ShellTreeItem | null>(null)
  const alsoDelete = ref(false)
  const removingSubmodel = ref(false)

  function editShell () {
    creating.value = null
    editingShell.value = true
    ui.detailsDrawer = true
  }

  /** Something about the shell changed: its header, references and tree are read again. */
  async function afterShellChange () {
    await queryCache.invalidateQueries({ key: ['targets', targetId.value] })
    await tree.trees.reload()
  }

  async function onShellChanged () {
    await queryCache.invalidateQueries({ key: ['targets', targetId.value] })
  }

  async function onRestored () {
    await afterShellChange()
  }
  // Undo and redo are the package bar's (package editing plan, H5).
  onWorkspaceRestored(() => targetId.value, onRestored)

  async function onInstanceCreated (result: ShellCreateResult) {
    await queryCache.invalidateQueries({ key: ['targets', targetId.value] })
    notifications.notify({ text: t('instance.created', { name: result.shell.idShort ?? result.shell.id }), color: 'success' })
    await router.push(`/targets/${targetId.value}/shells/${result.shell.key}`)
  }

  async function removeSubmodel () {
    const item = removeSubmodelTarget.value
    if (!item) {
      return
    }
    removingSubmodel.value = true
    await tree.guard(async () => {
      await api(`/targets/${targetId.value}/shells/${shellKey.value}/submodel-refs/${item.submodelKey}`, {
        method: 'DELETE',
        query: { deleteSubmodel: String(alsoDelete.value) },
      })
      if (selectedItem.value?.submodelKey === item.submodelKey) {
        tree.select(null)
      }
      await afterShellChange()
    })
    removingSubmodel.value = false
    removeSubmodelTarget.value = null
    alsoDelete.value = false
  }

  const shareOpen = ref(false)
  const qrOpen = ref(false)
  const globalAssetId = computed(() => typeof shellJson.value.assetInformation?.globalAssetId === 'string' ? shellJson.value.assetInformation.globalAssetId as string : null)
  const qrPreview = computed(() => globalAssetId.value ? svgDataUrl(identificationLinkSvg(globalAssetId.value)) : '')
  const confirmDelete = ref(false)

  // The header's actions, by how long they stay inline (H3): Edit first in
  // edit mode, Export as the one action of view mode.
  const headerActions = computed<HeaderAction[]>(() => [
    ...(canEditShell.value ? [{ id: 'edit', title: t('shell.edit'), icon: 'mdi-pencil-outline', rank: 1, onClick: editShell }] : []),
    ...(canEditShell.value && assetKind.value === 'Type' ? [{ id: 'instance', title: t('instance.create'), icon: 'mdi-content-copy', rank: 3, onClick: () => (instanceOpen.value = true) }] : []),
    ...(canShare.value ? [{ id: 'share', title: t('share.share'), icon: 'mdi-account-multiple-plus-outline', rank: 4, onClick: () => (shareOpen.value = true) }] : []),
    ...(capabilities.value.export
      ? [{
        id: 'export',
        title: t('shell.export'),
        icon: 'mdi-download',
        rank: 2,
        primary: true,
        items: exportFormats.value.map(format => ({ ...format, href: studioUrl.api(`/targets/${targetId.value}/shells/${shellKey.value}/export?format=${format.value}`) })),
      }]
      : []),
    { id: 'copy', title: t('copies.copyShell'), icon: 'mdi-content-copy', rank: 5, menuOnly: true, onClick: copyShell },
    ...(globalAssetId.value ? [{ id: 'qr', title: t('qr.show'), icon: 'mdi-qrcode', rank: 5, narrowOnly: true, onClick: () => (qrOpen.value = true) }] : []),
    ...(canDelete.value ? [{ id: 'delete', title: t('shell.delete'), icon: 'mdi-delete-outline', rank: 6, danger: true, onClick: () => (confirmDelete.value = true) }] : []),
  ])
  // Copy and paste (package editing plan, K1, K2, K10): the shell, and a
  // copied submodel into it.
  const copies = useCopyActions()
  const copyShell = () => copies.copyShell(targetId.value, shellKey.value, shellLabel.value)
  const pastedSubmodel = computed(() => canEditShell.value ? copies.pasteable('submodel') : null)
  const pasteSubmodel = () => copies.paste(targetId.value, shellKey.value)
  const textOpen = ref(false)
  // ⌘C copies the shell; ⌘V pastes a copied submodel into it, or a copied shell into the target.
  tree.bindClipboardKeys({
    copy: () => ({ title: t('palette.structure.copy', { name: shellLabel.value }), run: copyShell }),
    paste: () => {
      if (pastedSubmodel.value) {
        return { title: t('copies.pasteInto', { name: pastedSubmodel.value.label }), run: pasteSubmodel }
      }
      const shell = canEditShell.value ? copies.pasteable('shell') : null
      return shell ? { title: t('copies.pasteInto', { name: shell.label }), run: () => copies.paste(targetId.value) } : null
    },
  })
  const alsoDeleteSubmodels = ref(false)
  const deleting = ref(false)

  async function remove () {
    deleting.value = true
    actionError.value = null
    try {
      const result = await api<DeleteResult>(`/targets/${targetId.value}/shells/${shellKey.value}`, { method: 'DELETE', query: { deleteSubmodels: String(alsoDeleteSubmodels.value) } })
      confirmDelete.value = false
      const failed = result.sync.filter(step => step.outcome === 'failed').length
      notifications.notify(failed > 0
        ? { text: t('shell.deletedSyncFailed', { name: shellLabel.value, count: failed }), color: 'warning' }
        : { text: t('shell.deleted', { name: shellLabel.value }), color: 'success' })
      await invalidate(['targets', targetId.value, 'shells'], ['targets', targetId.value])
      await router.push(`/targets/${targetId.value}/shells`)
    } catch (error) {
      confirmDelete.value = false
      actionError.value = error
    } finally {
      deleting.value = false
    }
  }

  const authRequired = computed(() => [shell.error.value, refs.error.value]
    .some(error => error instanceof StudioApiError && error.code === 'target_auth_required'))

  async function onAuthorized () {
    await invalidate(['targets', targetId.value])
  }
</script>
