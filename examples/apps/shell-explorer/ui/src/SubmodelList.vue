<template>
  <v-progress-linear v-if="loading" />

  <v-alert v-else-if="error" :text="error" type="error" />

  <v-card v-else>
    <!-- Studio's shell page shows the submodels in their views (app API 0.1.4). -->
    <v-card-actions>
      <v-btn prepend-icon="mdi-open-in-app" text="Open in Studio" @click="open()" />
    </v-card-actions>

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
  import { onMounted, ref } from 'vue'

  const props = defineProps<{ client: StudioClient, shellId: string }>()

  const submodels = ref<SubmodelSummary[]>([])
  const loading = ref(true)
  const error = ref<string | null>(null)

  /** Opens Studio's page of the shell, with a submodel selected; called from a click, as Studio requires. */
  async function open (submodelId?: string) {
    try {
      await props.client.ui.openShell(props.shellId, { submodelId })
    } catch (error_) {
      error.value = error_ instanceof Error ? error_.message : String(error_)
    }
  }

  /**
   * Shows a submodel in the view Studio picks for it, in Studio's dialog over
   * this page; the page stays as it is. Without an installed view, Studio
   * says so (`unsupported_operation`), and the shell's page is the way there.
   */
  async function show (submodelId: string) {
    try {
      await props.client.ui.openView(submodelId, { shellId: props.shellId })
    } catch (error_) {
      error.value = error_ instanceof Error ? error_.message : String(error_)
    }
  }

  onMounted(async () => {
    try {
      submodels.value = (await props.client.aas.listSubmodels(props.shellId)).items
    } catch (error_) {
      error.value = error_ instanceof Error ? error_.message : String(error_)
    } finally {
      loading.value = false
    }
  })
</script>
