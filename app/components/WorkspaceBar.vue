<template>
  <!-- The open package's actions in the app bar, beside the target menu
       (package editing plan, H5): they act on the whole package, not on
       the shell or submodel the page shows. -->
  <div class="d-flex align-center ga-2 me-2">
    <!-- The package's state next to its actions (UX-005); narrower, the target menu's badge shows it. -->
    <v-chip
      v-if="lgAndUp"
      :color="target.workspace?.unsavedChanges ? 'warning' : 'success'"
      :prepend-icon="target.workspace?.unsavedChanges ? 'mdi-content-save-alert-outline' : 'mdi-content-save-check-outline'"
      :text="t(target.workspace?.unsavedChanges ? 'workspace.unsaved' : 'workspace.saved')"
    />

    <!-- Undo and redo of applied changes until Save or Close (W8) -->
    <v-btn-toggle v-if="target.capabilities.undo && ui.editing && smAndUp" class="flex-grow-0">
      <v-btn-toggle-icon
        v-tooltip="t('workspace.undo')"
        :aria-label="t('workspace.undo')"
        :disabled="!target.workspace?.canUndo || actions.busy.value !== null"
        icon="mdi-undo"
        @click="actions.restore('undos')"
      />

      <v-btn-toggle-icon
        v-tooltip="t('workspace.redo')"
        :aria-label="t('workspace.redo')"
        :disabled="!target.workspace?.canRedo || actions.busy.value !== null"
        icon="mdi-redo"
        @click="actions.restore('redos')"
      />
    </v-btn-toggle>

    <v-btn-primary
      v-if="mdAndUp"
      :disabled="!target.workspace?.unsavedChanges || actions.busy.value !== null"
      :loading="actions.busy.value === 'save'"
      prepend-icon="mdi-content-save-outline"
      :text="t('workspace.save')"
      @click="actions.save()"
    />

    <v-btn
      v-else
      v-tooltip="t('workspace.save')"
      :aria-label="t('workspace.save')"
      :disabled="!target.workspace?.unsavedChanges || actions.busy.value !== null"
      icon="mdi-content-save-outline"
      :loading="actions.busy.value === 'save'"
      @click="actions.save()"
    />

    <v-menu>
      <template #activator="{ props: activator }">
        <v-btn
          v-bind="activator"
          :aria-label="t('workspace.more')"
          icon="mdi-dots-vertical"
          :loading="actions.busy.value === 'saveAs' || actions.busy.value === 'close'"
        />
      </template>

      <v-card min-width="240">
        <v-list>
          <v-list-subheader :title="target.workspace?.fileName ?? target.name" />

          <template v-if="target.capabilities.undo && ui.editing && !smAndUp">
            <v-list-item
              :disabled="!target.workspace?.canUndo || actions.busy.value !== null"
              prepend-icon="mdi-undo"
              :title="t('workspace.undo')"
              @click="actions.restore('undos')"
            />

            <v-list-item
              :disabled="!target.workspace?.canRedo || actions.busy.value !== null"
              prepend-icon="mdi-redo"
              :title="t('workspace.redo')"
              @click="actions.restore('redos')"
            />

            <v-divider class="my-1" />
          </template>

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
      </v-card>
    </v-menu>

    <v-dialog v-model="actions.confirmClose.value" max-width="480">
      <DialogCard :title="t('workspace.closeTitle', { name: target.name })">
        {{ t('workspace.closeText') }}

        <template #actions>
          <v-btn :text="t('workspace.cancel')" @click="actions.confirmClose.value = false" />
          <v-btn-primary color="error" :text="t('workspace.closeWithoutSaving')" @click="actions.close(true)" />
        </template>
      </DialogCard>
    </v-dialog>
  </div>
</template>

<script lang="ts" setup>
  import type { Target } from '#shared/contract'
  import { useDisplay } from 'vuetify'

  const props = defineProps<{ target: Target }>()

  const { t } = useI18n()
  const ui = useUiStore()
  const { smAndUp, mdAndUp, lgAndUp } = useDisplay()
  const actions = useWorkspaceActions(() => props.target)
</script>
