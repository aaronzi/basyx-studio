<template>
  <!-- Fills its positioned parent; absolute, so the canvas's pixel size never stretches it. -->
  <div v-show="!hidden" class="position-absolute top-0 left-0 w-100 h-100" data-test="model-view-canvas">
    <div :ref="bind" class="w-100 h-100" />

    <div
      v-if="viewer.status.value === 'downloading' || viewer.status.value === 'processing'"
      class="position-absolute top-0 left-0 w-100 h-100 d-flex flex-column align-center justify-center ga-3 pa-8 bg-surface text-medium-emphasis"
    >
      <v-progress-circular :indeterminate="viewer.progress.value === null" :model-value="(viewer.progress.value ?? 0) * 100" />

      <span class="text-body-medium">{{ viewer.status.value === 'downloading' ? t('status.loading') : t('model3d.processing') }}</span>
    </div>
  </div>
</template>

<script lang="ts" setup>
  import type { ModelView } from '../model-view.ts'
  import type { ComponentPublicInstance } from 'vue'
  import { VProgressCircular } from 'vuetify/components/VProgressCircular'
  import { useFileViewerContext } from '../i18n.ts'

  // The 3D view's canvas with its loading state, inside whatever frame the
  // host draws around it: Studio's file view or an app's card.
  const props = defineProps<{
    view: ModelView
    /** Kept but not shown, e.g. while the host shows a preview image instead. */
    hidden?: boolean
  }>()

  const { t } = useFileViewerContext()
  const viewer = props.view.viewer

  function bind (element: Element | ComponentPublicInstance | null) {
    props.view.setHost(element instanceof HTMLElement ? element : null)
  }
</script>
