<template>
  <v-card>
    <!-- One row at every width: the filter takes the free space, the
         controls are icon buttons with tooltips (D10). A past state
         is named in the alert below. -->
    <div class="d-flex align-center ga-1 px-3 py-2">
      <v-text-field
        v-model="treeSearch"
        class="flex-grow-1 me-1"
        clearable
        density="compact"
        min-width="120"
        :placeholder="t('shell.filterElements')"
        prepend-inner-icon="mdi-filter-variant"
      />

      <v-menu v-if="capabilities.history" v-model="historyMenu" :close-on-content-click="false">
        <template #activator="{ props: activator }">
          <v-btn
            v-tooltip="asOf ? asOfLabel : t('history.pickHint')"
            v-bind="activator"
            :aria-label="asOf ? asOfLabel : t('history.now')"
            :color="asOf ? 'warning' : undefined"
            icon="mdi-history"
            size="small"
            :variant="asOf ? 'tonal' : 'text'"
          />
        </template>

        <v-card>
          <v-date-picker
            :max="new Date()"
            :model-value="asOf"
            show-adjacent-months
            :title="t('history.pick')"
            @update:model-value="tree.pickDate"
          />
        </v-card>
      </v-menu>

      <v-btn
        v-tooltip="autoRefresh ? t('shell.autoRefreshOn', { seconds: preferences.preferences.value.refreshIntervalSeconds }) : t('shell.autoRefreshOff')"
        :aria-label="t('shell.autoRefresh')"
        :aria-pressed="autoRefresh"
        :color="autoRefresh ? 'primary' : undefined"
        :disabled="Boolean(asOf)"
        :icon="autoRefresh ? 'mdi-sync' : 'mdi-sync-off'"
        size="small"
        :variant="autoRefresh ? 'tonal' : 'text'"
        @click="tree.toggleAutoRefresh"
      />

      <!-- The page's own tools, e.g. adding a submodel to the shell. -->
      <slot name="toolbar" />

      <v-btn
        v-tooltip="t('shell.expandAll')"
        :aria-label="t('shell.expandAll')"
        icon="mdi-unfold-more-horizontal"
        :loading="expanding"
        size="small"
        @click="tree.expandAll"
      />

      <v-btn
        v-tooltip="t('shell.collapseAll')"
        :aria-label="t('shell.collapseAll')"
        icon="mdi-unfold-less-horizontal"
        size="small"
        @click="tree.collapseAll"
      />
    </div>

    <v-divider />

    <v-expand-transition>
      <v-alert
        v-if="asOf"
        density="compact"
        icon="mdi-history"
        rounded="0"
        :text="t('history.readOnly', { date: asOfLabel })"
        type="warning"
      >
        <template #append>
          <v-btn :text="t('history.backToNow')" @click="asOf = null" />
        </template>
      </v-alert>
    </v-expand-transition>

    <ProblemAlert
      v-if="refsError"
      class="ma-2"
      :error="refsError"
      retry
      @retry="emit('retry')"
    />

    <!-- Only once mounted: the tree loads its levels while the page hydrates, which the server did not render. -->
    <v-progress-linear v-else-if="mounted && (refsLoading || tree.trees.loading.value)" />

    <div v-if="empty" class="pa-4 text-medium-emphasis">{{ emptyText }}</div>

    <v-treeview
      v-else
      v-model:activated="activated"
      v-model:opened="opened"
      active-strategy="single-independent"
      class="pa-2"
      indent-lines="default"
      item-props
      item-title="title"
      item-value="id"
      :items="treeItems"
      :load-children="tree.loadChildren"
      :search="treeSearch ?? undefined"
    >
      <template #prepend="{ item }">
        <v-icon v-if="item.more" icon="mdi-dots-horizontal" />

        <v-icon v-else :color="item.unavailable ? undefined : 'primary'" :icon="item.unavailable === 'forbidden' ? 'mdi-lock-outline' : modelTypeIcon(item.modelType)" />
      </template>

      <template #title="{ item }">
        <span v-if="item.more" class="text-primary">{{ t('shell.showMore', { count: Math.min(levelPageSize, item.more.remaining), remaining: item.more.remaining }) }}</span>

        <span v-else-if="item.unavailable" v-tooltip="t(`shell.unavailable.${item.unavailable}`)" class="text-disabled">{{ item.title }}</span>

        <span v-else :class="item.modelType === 'Submodel' ? 'font-weight-semibold' : undefined">
          {{ item.variableGroup ? t(`variables.${item.variableGroup}`) : item.title }}
        </span>

        <v-chip v-if="item.draft" class="ms-2" color="warning" :text="t('edit.draftNode')" />
      </template>

      <template #append="{ item }">
        <template v-if="item.modelType === 'Submodel'">
          <v-chip
            v-if="item.refreshable && refreshSeconds"
            class="me-1"
            color="success"
            prepend-icon="mdi-refresh-auto"
            size="x-small"
            :text="t('shell.autoRefresh')"
          />

          <!-- The template and version the semantic ID names; the full ID on hover. -->
          <v-chip
            v-if="mdAndUp && tree.templateLabel(item)"
            v-tooltip="item.semanticId"
            size="x-small"
            :text="tree.templateLabel(item)!"
          />
        </template>

        <span v-else-if="item.preview" class="text-body-small text-medium-emphasis text-truncate ms-2">
          {{ item.preview }}<template v-if="unitTypes.has(item.modelType) && tree.unitOf(item.semanticId)">&nbsp;{{ tree.unitOf(item.semanticId) }}</template>
        </span>

        <v-icon
          v-if="tree.hasDraft(item)"
          v-tooltip="t('edit.unsaved')"
          class="ms-1"
          color="warning"
          icon="mdi-circle-medium"
        />

        <!-- Structure actions: edit mode only (UX-006). One menu for the page (below), so
             a refresh of the rows never closes it. -->
        <v-btn
          v-if="canEditStructure && tree.hasActions(item)"
          :aria-label="t('edit.rowMenu')"
          class="ms-1"
          density="comfortable"
          icon="mdi-dots-vertical"
          size="x-small"
          @click.stop="tree.openRowMenu($event, item)"
        />
      </template>
    </v-treeview>
  </v-card>

  <v-menu v-model="rowMenuOpen" :activator="rowMenuActivator ?? undefined" :close-on-content-click="false" :open-on-click="false">
    <v-card v-if="menuItem" @click="tree.closeRowMenu">
      <v-list>
        <v-list-item
          v-if="menuItem.modelType === 'Submodel'"
          prepend-icon="mdi-pencil-outline"
          :title="t('edit.editSubmodel')"
          @click="tree.select(menuItem.id)"
        />

        <v-list-group v-if="tree.isContainerItem(menuItem) && menuItem.modelType !== 'SubmodelElementList'">
          <template #activator="{ props: group }">
            <v-list-item v-bind="group" prepend-icon="mdi-plus" :title="t('edit.addElement')" />
          </template>

          <v-list-item
            v-for="type in tree.addableTypes(menuItem)"
            :key="type"
            :prepend-icon="modelTypeIcon(type)"
            :title="type"
            @click="tree.startCreate(menuItem, type)"
          />
        </v-list-group>

        <v-list-item
          v-else-if="tree.isContainerItem(menuItem)"
          prepend-icon="mdi-plus"
          :title="t('edit.addElement')"
          @click="tree.startCreate(menuItem, null)"
        />

        <v-list-item
          v-if="tree.isContainerItem(menuItem) && tree.clipboard.copied"
          prepend-icon="mdi-content-paste"
          :subtitle="tree.clipboard.copied.label"
          :title="t('edit.paste')"
          @click="tree.pasteInto(menuItem)"
        />

        <v-list-item
          v-if="tree.isContainerItem(menuItem)"
          prepend-icon="mdi-code-json"
          :title="t('edit.insertJson')"
          @click="jsonTarget = menuItem"
        />

        <v-list-item
          v-if="menuItem.modelType === 'Submodel'"
          prepend-icon="mdi-content-duplicate"
          :title="t('copies.copySubmodel')"
          @click="copies.copySubmodel(tree.targetId.value, menuItem.submodelKey, menuItem.title)"
        />

        <template v-if="menuItem.modelType === 'Submodel' && capabilities.createResources">
          <v-list-item
            v-if="menuItem.kind === 'Template'"
            prepend-icon="mdi-file-replace-outline"
            :title="t('edit.convert')"
            @click="convertTarget = menuItem"
          />

          <!-- The page's own actions on a submodel, e.g. removing it from the shell. -->
          <slot :item="menuItem" name="submodel-actions" />
        </template>

        <template v-if="menuItem.elementKey">
          <v-divider v-if="tree.isContainerItem(menuItem)" class="my-1" />
          <v-list-item prepend-icon="mdi-content-copy" :title="t('edit.copy')" @click="tree.copyElement(menuItem)" />
          <v-list-item prepend-icon="mdi-link-variant" :title="t('edit.copyReference')" @click="tree.copyReference(menuItem)" />
          <v-list-item prepend-icon="mdi-content-duplicate" :title="t('edit.duplicate')" @click="tree.duplicate(menuItem)" />

          <v-divider class="my-1" />
          <v-list-item :disabled="!tree.canMove(menuItem) || tree.position(menuItem) <= 0" prepend-icon="mdi-arrow-up" :title="t('edit.moveUp')" @click="tree.move(menuItem, -1)" />
          <v-list-item :disabled="!tree.canMove(menuItem) || tree.position(menuItem) < 0 || tree.position(menuItem) >= tree.siblingCount(menuItem) - 1" prepend-icon="mdi-arrow-down" :title="t('edit.moveDown')" @click="tree.move(menuItem, 1)" />

          <v-divider class="my-1" />
          <v-list-item base-color="error" prepend-icon="mdi-delete-outline" :title="t('edit.delete')" @click="pendingDelete = menuItem" />
        </template>
      </v-list>
    </v-card>
  </v-menu>

  <v-dialog max-width="460" :model-value="convertTarget !== null" @update:model-value="open => { if (!open) convertTarget = null }">
    <DialogCard :title="t('edit.convertTitle')">
      {{ t('edit.convertText', { name: convertTarget?.title ?? '' }) }}

      <template #actions>
        <v-btn :text="t('common.cancel')" @click="convertTarget = null" />
        <v-btn-primary :loading="converting" :text="t('edit.convert')" @click="tree.convertToInstance" />
      </template>
    </DialogCard>
  </v-dialog>

  <JsonInsertDialog
    :kind="'element'"
    :model-value="jsonTarget !== null"
    :submit="tree.insertJson"
    :target-id="tree.targetId.value"
    :title="t('edit.insertJsonTitle', { name: jsonTarget?.title ?? '' })"
    @update:model-value="open => { if (!open) jsonTarget = null }"
  />

  <v-dialog max-width="420" :model-value="pendingDelete !== null" @update:model-value="open => { if (!open) pendingDelete = null }">
    <DialogCard :title="t('edit.deleteTitle')">
      {{ t('edit.deleteText', { name: pendingDelete?.title ?? '', type: pendingDelete?.modelType ?? '' }) }}

      <template #actions>
        <v-btn :text="t('common.cancel')" @click="pendingDelete = null" />
        <v-btn-primary color="error" :loading="removing" :text="t('edit.delete')" @click="tree.removeElement" />
      </template>
    </DialogCard>
  </v-dialog>
</template>

<script lang="ts" setup>
  import { useDisplay } from 'vuetify'
  import { injectElementTree } from '~/composables/useElementTree'
  import { levelPageSize } from '~/composables/useShellTrees'
  import { modelTypeIcon } from '~/utils/aas'

  // The element tree of the page's submodels with its toolbar, row menu and
  // structure dialogs (MVP-4 plan, T1; MVP-5 plan, U3, U4, C1). The page
  // provides the tree (useElementTree) and adds its own tools in the slots.
  defineProps<{
    /** The page's submodels could not be read. */
    refsError?: unknown
    refsLoading?: boolean
    /** There is no submodel to show, with the text to say so. */
    empty?: boolean
    emptyText?: string
  }>()
  const emit = defineEmits<{ retry: [] }>()

  const { t } = useI18n()
  const { mdAndUp } = useDisplay()
  const preferences = usePreferences()
  const tree = injectElementTree()
  const copies = useCopyActions()
  const unitTypes = new Set(['Property', 'Range'])
  const {
    capabilities,
    mounted,
    canEditStructure,
    asOf,
    asOfLabel,
    historyMenu,
    autoRefresh,
    refreshSeconds,
    treeItems,
    treeSearch,
    opened,
    activated,
    expanding,
    rowMenuOpen,
    rowMenuActivator,
    menuItem,
    jsonTarget,
    convertTarget,
    converting,
    pendingDelete,
    removing,
  } = tree
</script>
