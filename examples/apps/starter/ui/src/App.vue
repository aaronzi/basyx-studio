<template>
  <v-app>
    <div class="pa-4 d-flex flex-column ga-4">
      <v-alert v-if="error" :text="error" type="error" />

      <!-- Nested route shells/<key>: one shell and its submodels. -->
      <template v-if="shellId">
        <div class="d-flex align-center ga-2">
          <v-btn data-test="back" prepend-icon="mdi-arrow-left" :text="t('shells.all')" @click="client.ui.navigate('')" />
          <div class="text-h6 text-truncate" data-test="heading">{{ shellId }}</div>
        </div>

        <v-progress-linear v-if="loading" />

        <v-card v-else>
          <v-list data-test="submodels">
            <v-list-item v-if="submodels.length === 0" :title="t('submodels.none')" />

            <v-list-item
              v-for="entry in submodels"
              :key="entry.summary.id"
              prepend-icon="mdi-file-tree-outline"
              :subtitle="entry.summary.semanticId ?? entry.summary.id"
              :title="entry.summary.idShort ?? entry.summary.id"
            >
              <template #append>
                <v-chip v-if="entry.summary.status !== 'available'" :text="t('submodels.unavailable', { status: entry.summary.status })" />

                <div v-else class="d-flex flex-wrap ga-1 justify-end">
                  <v-chip
                    v-for="model in entry.models"
                    :key="model.path"
                    color="primary"
                    data-test="model"
                    prepend-icon="mdi-cube-outline"
                    :text="`${model.fileName} · ${modelFormatLabels[model.format]}`"
                  />

                  <v-chip v-if="entry.models.length === 0" :text="t('submodels.noModels')" />
                </div>
              </template>
            </v-list-item>
          </v-list>
        </v-card>
      </template>

      <template v-else>
        <div class="text-h6" data-test="heading">{{ t('shells.title', { target: context.target?.name ?? '' }) }}</div>

        <v-progress-linear v-if="loading" />

        <v-card v-else>
          <v-list data-test="shells">
            <v-list-item v-if="shells.length === 0" :title="t('shells.none')" />

            <v-list-item
              v-for="shell in shells"
              :key="shell.id"
              prepend-icon="mdi-cube-outline"
              :subtitle="shell.id"
              :title="langText(shell.displayName, context.locale) || shell.idShort || shell.id"
              @click="client.ui.navigate(shellPath(shell.id))"
            />
          </v-list>
        </v-card>
      </template>
    </div>
  </v-app>
</template>

<script lang="ts" setup>
  import type { ModelFile } from './shells'
  import type { ShellSummary, StudioClient, SubmodelSummary } from '@basyx/studio-sdk'
  import { modelFormatLabels } from '@basyx/model-viewer'
  import { langText } from '@basyx/studio-app-kit'
  import { computed, ref, watch } from 'vue'
  import { provideI18n } from './i18n'
  import { modelFiles, shellIdOf, shellPath } from './shells'

  const props = defineProps<{ client: StudioClient }>()
  const { t } = provideI18n(props.client)

  const context = ref(props.client.context)
  props.client.onContext(value => (context.value = value))
  const shellId = computed(() => shellIdOf(context.value.subPath))

  const shells = ref<ShellSummary[]>([])
  const submodels = ref<{ summary: SubmodelSummary, models: ModelFile[] }[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)

  async function load (id: string | null) {
    loading.value = true
    error.value = null
    try {
      if (id) {
        const { items } = await props.client.aas.listSubmodels(id)
        submodels.value = await Promise.all(items.map(async summary => ({
          summary,
          models: summary.status === 'available' ? modelFiles(await props.client.aas.getSubmodel(summary.id)) : [],
        })))
      } else {
        shells.value = (await props.client.aas.listShells({ limit: 100 })).items
      }
    } catch (error_) {
      error.value = error_ instanceof Error ? error_.message : String(error_)
    } finally {
      loading.value = false
    }
  }

  watch(shellId, id => load(id), { immediate: true })
</script>
