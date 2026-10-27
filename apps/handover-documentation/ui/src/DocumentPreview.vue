<template>
  <div class="d-flex flex-column ga-2" data-test="document-preview">
    <!-- The version's files and its preview image (the Web UI's "Preview File / Digital File" switch). -->
    <v-btn-toggle
      v-if="choices.length > 1"
      v-model="choice"
      class="align-self-start flex-wrap"
      data-test="document-files"
      mandatory
    >
      <v-btn
        v-for="entry in choices"
        :key="entry.file.path"
        :prepend-icon="entry.preview ? 'mdi-image-outline' : undefined"
        :text="entry.label"
        :value="entry.file.path"
      />
    </v-btn-toggle>

    <v-sheet
      v-if="file"
      border
      class="overflow-hidden"
      :height="fullscreen ? 720 : 520"
      rounded="lg"
    >
      <!-- The file viewer (ADR 0052) inline; maximize opens Studio's full-screen viewer. -->
      <FileViewer maximizable :state="state" @maximize="maximize" />
    </v-sheet>

    <v-alert v-else density="compact" :text="t('preview.noFile')" type="info" />
  </div>
</template>

<script lang="ts" setup>
  import type { DocumentVersion, FileRef } from './handoverDocumentation'
  import type { FileSource } from '@basyx/file-viewer/vue'
  import type { StudioClient } from '@basyx/studio-sdk'
  import { FileViewer } from '@basyx/file-viewer/viewer'
  import { useFileViewerState, withCachedContent } from '@basyx/file-viewer/vue'
  import { StudioError } from '@basyx/studio-sdk'
  import { computed } from 'vue'
  import { useI18n } from './i18n'
  import { fileLabel } from './presentation'

  // A version's file in the file viewer: one of its digital files (a PDF, a
  // drawing, a text) or its preview image. Internal files are read through
  // Studio (`readFile`), files at other hosts by Studio's page
  // (`readExternalFile`); the full-screen viewer is Studio's (`previewFile`).
  const props = defineProps<{
    client: StudioClient
    submodelId: string
    version: DocumentVersion | undefined
    fullscreen: boolean
  }>()
  const emit = defineEmits<{ error: [message: string] }>()
  /** The idShortPath of the chosen file. */
  const chosen = defineModel<string | undefined>('file')

  const { t } = useI18n()

  const choices = computed(() => {
    const files = (props.version?.digitalFiles ?? []).map(file => ({ file, preview: false, label: '' }))
    // Several files of one type are told apart by name.
    for (const entry of files) {
      const label = fileLabel(entry.file)
      entry.label = files.filter(other => fileLabel(other.file) === label).length > 1 ? entry.file.name : label
    }
    const preview = props.version?.preview
    return preview ? [...files, { file: preview, preview: true, label: t('preview.previewImage') }] : files
  })

  const choice = computed({
    get: () => (choices.value.some(entry => entry.file.path === chosen.value) ? chosen.value : choices.value[0]?.file.path),
    set: value => {
      chosen.value = value
    },
  })
  const file = computed<FileRef | undefined>(() => choices.value.find(entry => entry.file.path === choice.value)?.file)

  const source = computed<FileSource | null>(() => {
    const current = file.value
    if (!current) {
      return null
    }
    const submodelId = props.submodelId
    return withCachedContent({
      key: `${current.path}:${current.value}`,
      name: current.name,
      contentType: current.contentType,
      external: current.external ? current.value : null,
      load: () => (current.external
        ? props.client.ui.readExternalFile(submodelId, current.path)
        : props.client.ui.readFile(submodelId, current.path)),
    })
  })
  const state = useFileViewerState(source)

  function maximize () {
    if (file.value) {
      void props.client.ui.previewFile(props.submodelId, file.value.path).catch((error_: unknown) => {
        emit('error', error_ instanceof StudioError ? error_.message : String(error_))
      })
    }
  }
</script>
