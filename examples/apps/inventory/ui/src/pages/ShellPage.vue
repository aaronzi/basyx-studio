<template>
  <div class="d-flex flex-column ga-4">
    <div class="d-flex align-center ga-2">
      <v-btn data-test="back" prepend-icon="mdi-arrow-left" :text="t('shell.back')" :to="{ name: 'shells' }" />
      <div class="text-title-large text-truncate" data-test="heading">{{ shellId }}</div>
    </div>

    <v-alert v-if="error" :text="error" type="error" />

    <v-progress-linear v-if="loading" />

    <template v-else>
      <v-card :title="t('shell.submodels.title')">
        <v-list data-test="submodels">
          <v-list-item v-if="submodels.length === 0" :title="t('shell.submodels.none')" />

          <v-list-item
            v-for="item in submodels"
            :key="item.id"
            prepend-icon="mdi-file-tree-outline"
            :subtitle="item.status === 'available' ? item.semanticId ?? item.id : t('shell.submodels.unavailable', { status: item.status })"
            :title="item.idShort ?? item.id"
          />
        </v-list>
      </v-card>

      <v-card :title="t('shell.models.title')">
        <v-card-text v-if="models.length === 0">{{ t('shell.models.none') }}</v-card-text>

        <template v-else>
          <v-card-text>
            <v-btn-toggle v-model="selected" data-test="models" mandatory>
              <v-btn v-for="(model, index) in models" :key="`${model.submodelId}/${model.path}`" :text="model.fileName" :value="index" />
            </v-btn-toggle>
          </v-card-text>

          <v-responsive :aspect-ratio="16 / 9" max-height="560">
            <!-- The canvas fills the box; absolute, so its pixel size never stretches it. -->
            <div ref="host" class="position-absolute top-0 left-0 w-100 h-100" data-test="viewer" />

            <div
              v-if="viewer.status.value === 'downloading' || viewer.status.value === 'processing'"
              class="position-absolute top-0 left-0 w-100 h-100 d-flex align-center justify-center ga-3 bg-surface text-medium-emphasis"
            >
              <v-progress-circular :indeterminate="viewer.progress.value === null" :model-value="(viewer.progress.value ?? 0) * 100" />
              {{ t('shell.models.loading') }}
            </div>
          </v-responsive>

          <v-card-text v-if="viewer.problem.value" class="text-error">{{ t('shell.models.failed', { message: viewer.problem.value.message }) }}</v-card-text>

          <v-card-text v-else-if="viewer.result.value" class="text-medium-emphasis" data-test="triangles">
            {{ t('shell.models.triangles', { count: number.format(viewer.result.value.triangles) }) }}
          </v-card-text>
        </template>
      </v-card>
    </template>
  </div>
</template>

<script lang="ts" setup>
  import type { IfcModel } from '../inventory'
  import type { SubmodelSummary } from '@basyx/studio-sdk'
  import { viewerThemeOf } from '@basyx/file-viewer'
  // Only the IFC parser: the build holds web-ifc's WebAssembly and worker, and none of STEP's.
  import { ifcParser } from '@basyx/file-viewer/model/ifc'
  import { useModelViewer } from '@basyx/file-viewer/model/vue/core'
  import { computed, ref, watch } from 'vue'
  import { useClient } from '../client'
  import { useI18n } from '../i18n'
  import { ifcModels, shellIdOf } from '../inventory'

  const props = defineProps<{ shell: string }>()

  const { client, context } = useClient()
  const { t, formatLocale } = useI18n()
  const number = computed(() => new Intl.NumberFormat(formatLocale.value))

  const shellId = computed(() => shellIdOf(props.shell))
  const submodels = ref<SubmodelSummary[]>([])
  const models = ref<(IfcModel & { submodelId: string })[]>([])
  const selected = ref(0)
  const loading = ref(false)
  const error = ref<string | null>(null)

  const host = ref<HTMLElement | null>(null)
  const theme = computed(() => viewerThemeOf(context.value.theme.colors, context.value.theme.dark))
  const viewer = useModelViewer(host, () => theme.value, { parsers: [ifcParser] })

  watch([shellId, () => context.value.target?.id], async ([id]) => {
    loading.value = true
    error.value = null
    submodels.value = []
    models.value = []
    selected.value = 0
    try {
      if (!id) {
        throw new Error(`No shell has the key ${props.shell}.`)
      }
      submodels.value = (await client.aas.listSubmodels(id)).items
      const available = submodels.value.filter(item => item.status === 'available')
      const contents = await Promise.all(available.map(item => client.aas.getSubmodel(item.id)))
      models.value = contents.flatMap((submodel, index) => ifcModels(submodel).map(model => ({ ...model, submodelId: available[index]!.id })))
    } catch (error_) {
      error.value = error_ instanceof Error ? error_.message : String(error_)
    } finally {
      loading.value = false
    }
  }, { immediate: true })

  // The host is rendered once the models are known.
  watch([host, selected], ([element, index]) => {
    const model = models.value[index]
    if (element && model) {
      void viewer.load(async () => (await client.ui.readFile(model.submodelId, model.path)).bytes, 'ifc')
    }
  })
</script>
