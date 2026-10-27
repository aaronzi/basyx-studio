<template>
  <div class="d-flex flex-column ga-2" data-test="document-preview">
    <!-- The version's files and its preview image (the Web UI's "Preview File /
         Digital File" switch), in a menu like the version's, for any number of files. -->
    <v-menu v-if="choices.length > 1">
      <template #activator="{ props: activator }">
        <v-chip
          v-bind="activator"
          append-icon="mdi-chevron-down"
          class="align-self-start"
          data-test="document-files"
          link
          :prepend-icon="current?.icon"
          :text="current?.title"
        />
      </template>

      <v-list min-width="240">
        <v-list-item
          v-for="entry in choices"
          :key="entry.file.path"
          :active="entry.file.path === choice"
          data-test="document-file"
          :prepend-icon="entry.icon"
          :subtitle="entry.subtitle"
          :title="entry.title"
          @click="choice = entry.file.path"
        />
      </v-list>
    </v-menu>

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
  import { detectViewerKind, viewerKindIcon } from '@basyx/file-viewer'
  import { FileViewer } from '@basyx/file-viewer/viewer'
  import { useFileViewerState, withCachedContent } from '@basyx/file-viewer/vue'
  import { StudioError } from '@basyx/studio-sdk'
  import { computed } from 'vue'
  import { useI18n } from './i18n'

  // A version's file in the file viewer: one of its digital files (a PDF, a
  // drawing, a text) or its preview image. Internal files are read through
  // Studio (`readFile`), files at other hosts by Studio's page
  // (`readExternalFile`); the full-screen viewer is Studio's (`previewFile`),
  // and so are downloads (`openFile`).
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

  /** The digital files, then the preview image, each with what the menu shows. */
  const choices = computed(() => {
    const files = (props.version?.digitalFiles ?? []).map(file => ({
      file,
      title: file.name,
      subtitle: file.contentType,
      icon: viewerKindIcon(detectViewerKind({ contentType: file.contentType, fileName: file.name })),
    }))
    const preview = props.version?.preview
    return preview ? [...files, { file: preview, title: t('preview.previewImage'), subtitle: preview.name, icon: 'mdi-image-outline' }] : files
  })

  const choice = computed({
    get: () => (choices.value.some(entry => entry.file.path === chosen.value) ? chosen.value : choices.value[0]?.file.path),
    set: value => {
      chosen.value = value
    },
  })
  const current = computed(() => choices.value.find(entry => entry.file.path === choice.value))
  const file = computed<FileRef | undefined>(() => current.value?.file)

  const source = computed<FileSource | null>(() => {
    const shown = file.value
    if (!shown) {
      return null
    }
    const submodelId = props.submodelId
    return withCachedContent({
      key: `${shown.path}:${shown.value}`,
      name: shown.name,
      contentType: shown.contentType,
      external: shown.external ? shown.value : null,
      load: () => (shown.external
        ? props.client.ui.readExternalFile(submodelId, shown.path)
        : props.client.ui.readFile(submodelId, shown.path)),
      // The frame cannot download: Studio saves the file, or opens one at another host.
      download: () => void (shown.external
        ? props.client.ui.openExternal(shown.value)
        : props.client.ui.openFile(submodelId, shown.path, true)).catch(fail),
    })
  })
  const state = useFileViewerState(source)

  function fail (error_: unknown) {
    emit('error', error_ instanceof StudioError ? error_.message : String(error_))
  }

  function maximize () {
    if (file.value) {
      void props.client.ui.previewFile(props.submodelId, file.value.path).catch(fail)
    }
  }
</script>
