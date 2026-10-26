<template>
  <div class="d-flex flex-column flex-grow-1 overflow-hidden" data-test="model-view">
    <v-alert
      v-if="viewer.result.value && viewer.result.value.missingImages.length > 0"
      class="ma-2 flex-shrink-0"
      density="compact"
      :text="t('model3d.missingImages', { files: viewer.result.value.missingImages.join(', ') })"
      type="warning"
    />

    <v-sheet class="flex-grow-1 position-relative overflow-hidden" color="transparent" min-height="280" rounded="0">
      <ModelCanvas :view="view" />

      <div v-if="viewer.status.value === 'ready'" class="position-absolute top-0 left-0 d-flex align-center ga-2 ma-2">
        <v-chip :text="modelFormatLabels[viewer.result.value?.format ?? format]" />

        <v-chip v-if="viewer.result.value" :text="t('model3d.triangles', { count: viewer.result.value.triangles })" />
      </div>

      <v-btn
        v-if="viewer.status.value === 'ready'"
        v-tooltip="t('model3d.resetView')"
        :aria-label="t('model3d.resetView')"
        class="position-absolute top-0 right-0 ma-2"
        icon="mdi-fit-to-screen-outline"
        size="small"
        @click="viewer.resetView()"
      />

      <v-empty-state
        v-if="viewer.problem.value"
        class="position-absolute top-0 left-0 w-100 h-100 bg-surface"
        icon="mdi-cube-off-outline"
        size="56"
        :text="view.problemText.value"
        :title="t('model3d.failed')"
      />
    </v-sheet>

    <v-sheet v-if="viewer.result.value?.pickable" class="flex-shrink-0 overflow-y-auto pa-2" color="transparent" max-height="45%">
      <ModelElementPanel :view="view" />
    </v-sheet>
  </div>
</template>

<script lang="ts" setup>
  import type { ModelFormat } from '@basyx/model-viewer'
  import { modelFormatLabels, viewerThemeOf } from '@basyx/model-viewer'
  import { onMounted, watch } from 'vue'
  import { useTheme } from 'vuetify'
  import { VAlert } from 'vuetify/components/VAlert'
  import { VBtn } from 'vuetify/components/VBtn'
  import { VChip } from 'vuetify/components/VChip'
  import { VEmptyState } from 'vuetify/components/VEmptyState'
  import { VSheet } from 'vuetify/components/VSheet'
  import { useFileViewerContext } from '../i18n.ts'
  import { useModelView } from '../model-view.ts'
  import ModelCanvas from './ModelCanvas.vue'
  import ModelElementPanel from './ModelElementPanel.vue'

  // A 3D model (STL, OBJ, glTF, IFC, STEP) in the file viewer, from bytes it
  // has read, built from the parts apps use too (`@basyx/file-viewer/model`).
  const props = defineProps<{ bytes: Uint8Array, format: ModelFormat }>()

  const { t } = useFileViewerContext()
  const theme = useTheme()
  const view = useModelView(() => viewerThemeOf(theme.current.value.colors, theme.current.value.dark))
  const viewer = view.viewer

  function load () {
    void view.load(async () => props.bytes, props.format)
  }

  onMounted(load)
  watch(() => [props.bytes, props.format], load)
</script>
