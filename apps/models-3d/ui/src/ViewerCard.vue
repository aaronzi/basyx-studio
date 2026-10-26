<template>
  <div class="d-flex flex-column ga-2">
    <v-sheet border class="overflow-hidden" data-test="viewer-card" rounded="lg">
      <v-responsive :aspect-ratio="4 / 3" max-height="560" min-height="260">
        <!-- The shared 3D view's canvas and loading state (@basyx/file-viewer/model). -->
        <ModelCanvas data-test="viewer-canvas" :hidden="!showModel" :view="view" />

        <div v-if="!showModel" class="d-flex flex-column align-center justify-center h-100 w-100">
          <PreviewImage
            :alt="title"
            :client="client"
            contain
            :file="version?.preview ?? null"
            icon-size="64"
            :submodel-id="submodelId"
          />
        </div>

        <v-chip
          v-if="formatText"
          class="position-absolute top-0 left-0 ma-2"
          color="surface"
          :text="formatText"
          variant="flat"
        />

        <v-chip
          v-if="viewer.problem.value && !showImage && !externalFailed"
          class="position-absolute bottom-0 left-0 ma-2"
          color="warning"
          prepend-icon="mdi-alert-outline"
          :text="t('viewer.failed')"
          variant="elevated"
        />

        <!-- Controls over the canvas, as the BOM viewer's graph has them; solid, like the format chip, so they show on a light preview image too. -->
        <div class="position-absolute top-0 right-0 d-flex ga-1 ma-2">
          <v-btn
            v-if="showModel"
            :aria-label="t('viewer.resetView')"
            color="surface"
            :disabled="viewer.status.value !== 'ready'"
            icon
            size="small"
            variant="flat"
            @click="viewer.resetView()"
          >
            <v-icon icon="mdi-fit-to-screen-outline" />
            <v-tooltip activator="parent" location="bottom" :text="t('viewer.resetView')" />
          </v-btn>

          <v-btn
            v-if="canToggle"
            :aria-label="toggleLabel"
            color="surface"
            data-test="viewer-toggle"
            icon
            size="small"
            variant="flat"
            @click="showImage = !showImage"
          >
            <v-icon :icon="showImage ? 'mdi-rotate-3d-variant' : 'mdi-image-outline'" />
            <v-tooltip activator="parent" location="bottom" :text="toggleLabel" />
          </v-btn>

          <v-btn
            v-if="version?.digital"
            :aria-label="t('viewer.download')"
            color="surface"
            icon
            size="small"
            variant="flat"
            @click="emit('download', version.digital.path)"
          >
            <v-icon icon="mdi-download" />
            <v-tooltip activator="parent" location="bottom" :text="t('viewer.download')" />
          </v-btn>

          <v-btn
            v-if="external && !externalFailed"
            :aria-label="t('viewer.openExternal')"
            color="surface"
            icon
            size="small"
            variant="flat"
            @click="emit('open', externalUrl)"
          >
            <v-icon icon="mdi-open-in-new" />
            <v-tooltip activator="parent" location="bottom" :text="t('viewer.openExternalAt', { host: externalHost })" />
          </v-btn>

          <v-btn
            v-if="!fullscreen"
            :aria-label="t('viewer.fullscreen')"
            color="surface"
            data-test="viewer-fullscreen"
            icon
            size="small"
            variant="flat"
            @click="emit('fullscreen')"
          >
            <v-icon icon="mdi-fullscreen" />
            <v-tooltip activator="parent" location="bottom" :text="t('viewer.fullscreen')" />
          </v-btn>
        </div>
      </v-responsive>
    </v-sheet>

    <v-alert v-if="notice" density="compact" :text="notice" type="info" />

    <!-- A file at another host that is not shown in 3D (its format, or the host refused Studio):
         the preview fills the box, and the link is said and offered below it. -->
    <v-alert
      v-if="!version?.digital && externalUrl && (!external || externalFailed)"
      data-test="viewer-external"
      density="compact"
      :text="externalFailed ? t('viewer.externalFailed', { host: externalHost }) : t('viewer.external', { host: externalHost })"
      type="info"
    >
      <template #append>
        <v-btn prepend-icon="mdi-open-in-new" :text="t('viewer.openExternal')" @click="emit('open', externalUrl)" />
      </template>
    </v-alert>

    <v-alert v-if="problemText && !showImage && !externalFailed" density="compact" :text="problemText" type="warning" />

    <v-alert
      v-if="viewer.result.value && viewer.result.value.missingImages.length > 0"
      density="compact"
      :text="viewerText('model3d.missingImages', { files: viewer.result.value.missingImages.join(', ') })"
      type="warning"
    />

    <!-- IFC: the picked element's attributes and property sets. -->
    <ModelElementPanel v-if="showModel" data-test="viewer-element" :view="view" />
  </div>
</template>

<script lang="ts" setup>
  import type { Model3DVersion } from './models3d'
  import type { ViewerTheme } from '@basyx/model-viewer'
  import type { StudioClient } from '@basyx/studio-sdk'
  import { ModelCanvas, ModelElementPanel, useModelView } from '@basyx/file-viewer/model'
  import { useFileViewerContext } from '@basyx/file-viewer/vue'
  import { modelFormatLabels } from '@basyx/model-viewer'
  import { computed, onMounted, ref, watch } from 'vue'
  import { useI18n } from './i18n'
  import { externalModel, viewerFormat } from './models3d'
  import { formatLabel } from './presentation'
  import PreviewImage from './PreviewImage.vue'

  // A version's model in 3D (the Web UI's Models3DViewerCard and CADPreview),
  // its preview image where it has no file the viewer reads, and a link to
  // an external host where the file is only there. The canvas, its loading
  // state, the picked IFC element and the problem texts are the file
  // viewer's 3D view (ADR 0052); the frame and controls are the app's.
  const props = defineProps<{
    client: StudioClient
    submodelId: string
    version: Model3DVersion | undefined
    title: string
    theme: ViewerTheme
    fullscreen: boolean
  }>()
  const emit = defineEmits<{
    open: [url: string]
    download: [path: string]
    fullscreen: []
  }>()

  const { t } = useI18n()
  const { t: viewerText } = useFileViewerContext()
  const view = useModelView(() => props.theme)
  const viewer = view.viewer

  const showImage = ref(false)
  // A file of its own, else one at another host, which Studio's page fetches (`readExternalFile`).
  const external = computed(() => externalModel(props.version))
  const format = computed(() => viewerFormat(props.version) ?? external.value?.format ?? null)
  const canView = computed(() => format.value !== null)
  const showModel = computed(() => canView.value && !showImage.value && !viewer.problem.value)
  const canToggle = computed(() => canView.value && Boolean(props.version?.preview) && !viewer.problem.value)
  const toggleLabel = computed(() => (showImage.value ? t('viewer.showModel') : t('viewer.showImage')))
  const externalUrl = computed(() => external.value?.file.url ?? props.version?.externalFiles.find(file => /^https?:\/\//i.test(file.url))?.url ?? '')
  /** The host did not hand out the file (unreachable, CORS, too large): its preview and link instead. */
  const externalFailed = computed(() => Boolean(external.value) && viewer.problem.value?.code === 'download')
  const externalHost = computed(() => URL.parse(externalUrl.value)?.host ?? externalUrl.value)
  const formatText = computed(() => {
    // "binary (.glb)" → ".glb"
    const qualifier = props.version?.format.qualifier.match(/\(([^)]+)\)/)?.[1]
    return [formatLabel(props.version) || (format.value ? modelFormatLabels[format.value] : ''), qualifier].filter(Boolean).join(' · ')
  })
  const notice = computed(() => {
    if (!props.version?.digital) {
      return externalUrl.value ? '' : t('viewer.noFile')
    }
    return canView.value ? '' : t('viewer.unsupported', { format: formatLabel(props.version) || props.version.fileName })
  })
  const problemText = computed(() => view.problemText.value)

  async function load () {
    const version = props.version
    if (!format.value) {
      return
    }
    if (version?.digital) {
      const path = version.digital.path
      await view.load(async () => (await props.client.ui.readFile(props.submodelId, path)).bytes, format.value)
    } else if (external.value) {
      const path = external.value.file.urlPath
      await view.load(async () => (await props.client.ui.readExternalFile(props.submodelId, path)).bytes, format.value)
    }
  }

  onMounted(load)
  watch(() => props.version?.key, () => {
    showImage.value = false
    void load()
  })
</script>
