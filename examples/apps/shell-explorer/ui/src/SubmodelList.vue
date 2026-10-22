<template>
  <v-progress-linear v-if="loading" />

  <v-alert v-else-if="error" :text="error" type="error" />

  <v-card v-else>
    <!-- Studio's shell page shows the submodels in their views (app API 0.1.4). -->
    <v-card-actions>
      <v-btn prepend-icon="mdi-open-in-app" text="Open in Studio" @click="open()" />
    </v-card-actions>

    <!-- A refused action leaves the list and its ways into Studio as they are.
         Without a view for the submodel, its shell page is the way there. -->
    <v-alert
      v-if="notice"
      class="mx-4"
      closable
      data-test="notice"
      :text="notice.text"
      :type="notice.type"
      @click:close="notice = null"
    >
      <template v-if="notice.submodelId" #append>
        <v-btn text="Open in Studio" @click="open(notice.submodelId)" />
      </template>
    </v-alert>

    <v-list data-test="submodels" density="compact">
      <v-list-item
        v-for="submodel in submodels"
        :key="submodel.id"
        prepend-icon="mdi-file-tree-outline"
        :subtitle="submodel.semanticId ?? submodel.id"
        :title="submodel.idShort ?? submodel.id"
        @click="submodel.status === 'available' && open(submodel.id)"
      >
        <template #append>
          <v-chip v-if="submodel.status !== 'available'" :text="submodel.status" />
          <!-- The submodel in an installed app's view, over this page (app API 0.1.10). -->
          <v-btn
            v-else-if="submodel.semanticId"
            :aria-label="`Show ${submodel.idShort ?? submodel.id} in its view`"
            icon="mdi-application-outline"
            size="small"
            variant="text"
            @click.stop="show(submodel.id)"
          />
        </template>
      </v-list-item>
    </v-list>
  </v-card>
</template>

<script lang="ts" setup>
  import type { StudioClient, SubmodelSummary } from '@basyx/studio-sdk'
  import { StudioError } from '@basyx/studio-sdk'
  import { onMounted, ref } from 'vue'

  const props = defineProps<{ client: StudioClient, shellId: string }>()

  const submodels = ref<SubmodelSummary[]>([])
  const loading = ref(true)
  /** Why the list could not be read; the page shows nothing else then. */
  const error = ref<string | null>(null)
  /** What became of the last action; the list stays. With `submodelId`, the shell page is offered for it. */
  const notice = ref<{ text: string, type: 'info' | 'error', submodelId?: string } | null>(null)

  function messageOf (error_: unknown): string {
    return error_ instanceof Error ? error_.message : String(error_)
  }

  /** Opens Studio's page of the shell, with a submodel selected; called from a click, as Studio requires. */
  async function open (submodelId?: string) {
    notice.value = null
    try {
      await props.client.ui.openShell(props.shellId, { submodelId })
    } catch (error_) {
      notice.value = { text: messageOf(error_), type: 'error' }
    }
  }

  /**
   * Shows a submodel in the view Studio picks for it, in Studio's dialog over
   * this page; the page stays as it is. Without an installed view, Studio
   * says so (`unsupported_operation`), and the shell's page is the way there.
   */
  async function show (submodelId: string) {
    notice.value = null
    try {
      await props.client.ui.openView(submodelId, { shellId: props.shellId })
    } catch (error_) {
      notice.value = error_ instanceof StudioError && error_.code === 'unsupported_operation'
        ? { text: 'No installed app shows this submodel in a view. Open it on Studio\'s shell page instead.', type: 'info', submodelId }
        : { text: messageOf(error_), type: 'error' }
    }
  }

  onMounted(async () => {
    try {
      submodels.value = (await props.client.aas.listSubmodels(props.shellId)).items
    } catch (error_) {
      error.value = messageOf(error_)
    } finally {
      loading.value = false
    }
  })
</script>
