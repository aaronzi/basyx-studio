<template>
  <div class="d-flex align-center justify-center flex-grow-1 overflow-auto pa-4" data-test="file-preview" @click.self="emit('close')">
    <v-sheet v-if="file.external" class="pa-6" max-width="500" rounded="lg">
      <v-empty-state data-test="external-file" icon="mdi-file-link" :text="t('preview.external', { url: file.external })" :title="t('preview.noneTitle')" />
    </v-sheet>

    <v-progress-circular v-else-if="loading" color="primary" indeterminate size="64" />

    <v-sheet v-else-if="error" class="pa-6" max-width="500" rounded="lg">
      <v-empty-state
        color="error"
        data-test="preview-error"
        icon="mdi-alert-circle"
        :text="error"
        :title="t('preview.failedTitle')"
      />
    </v-sheet>

    <v-img
      v-else-if="kind === 'image' && url"
      :alt="file.name"
      data-test="image-preview"
      height="100%"
      :src="url"
    />

    <v-sheet
      v-else-if="kind === 'pdf' && content"
      class="pa-2"
      color="transparent"
      height="100%"
      width="100%"
    >
      <pdf-preview :bytes="content.bytes" />
    </v-sheet>

    <v-sheet
      v-else-if="kind === 'text' && content"
      class="overflow-auto"
      max-height="100%"
      max-width="1000"
      rounded="lg"
      width="100%"
    >
      <v-code class="d-block text-pre-wrap text-break pa-4" data-test="text-preview">{{ text }}</v-code>
      <p v-if="truncated" class="text-body-small text-medium-emphasis px-4 pb-2">{{ t('preview.truncated', { size: formatSize(textLimit, locale) }) }}</p>
    </v-sheet>

    <video
      v-else-if="kind === 'video' && url"
      class="d-block w-100 h-100"
      controls
      data-test="video-preview"
      :src="url"
    />

    <audio
      v-else-if="kind === 'audio' && url"
      controls
      data-test="audio-preview"
      :src="url"
    />

    <v-sheet v-else-if="kind === 'none'" class="pa-6" max-width="500" rounded="lg">
      <v-empty-state data-test="no-preview" icon="mdi-file-eye-outline" :text="t('preview.none')" :title="t('preview.noneTitle')">
        <template #actions>
          <v-btn-primary data-test="preview-download" prepend-icon="mdi-download" :text="t('fs.download')" @click="emit('download')" />
        </template>
      </v-empty-state>
    </v-sheet>
  </div>
</template>

<script lang="ts" setup>
  import type { FileEntry } from './fileSystem'
  import type { FileContent, StudioClient } from '@basyx/studio-sdk'
  import { StudioError } from '@basyx/studio-sdk'
  import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
  import { formatSize, previewKind } from './fileSystem'
  import { useI18n } from './i18n'
  import PdfPreview from './PdfPreview.vue'

  // The content of the file being previewed, read through Studio
  // (`studio.ui.readFile`): images, PDFs drawn by PDF.js, text, audio and
  // video; for other files the Web UI's "No preview available" with Download.
  const props = defineProps<{ client: StudioClient, submodelId: string, file: FileEntry, locale: string }>()
  const emit = defineEmits<{ close: [], download: [] }>()
  const { t } = useI18n()

  /** Text files are shown up to this size. */
  const textLimit = 256 * 1024

  const content = shallowRef<FileContent | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)
  const url = ref('')

  const kind = computed(() => previewKind(content.value?.contentType || props.file.contentType))
  const truncated = computed(() => (content.value?.bytes.byteLength ?? 0) > textLimit)
  const text = computed(() => content.value ? new TextDecoder().decode(content.value.bytes.subarray(0, textLimit)) : '')

  function release () {
    if (url.value) {
      URL.revokeObjectURL(url.value)
    }
    url.value = ''
  }

  watch(() => props.file.path, async () => {
    release()
    content.value = null
    error.value = null
    const file = props.file
    if (file.external || previewKind(file.contentType) === 'none') {
      return
    }
    loading.value = true
    try {
      const read = await props.client.ui.readFile(props.submodelId, file.path)
      if (file !== props.file) {
        return
      }
      content.value = read
      if (['image', 'video', 'audio'].includes(previewKind(read.contentType || file.contentType))) {
        url.value = URL.createObjectURL(new Blob([read.bytes as BlobPart], { type: read.contentType || file.contentType }))
      }
    } catch (error_) {
      error.value = error_ instanceof StudioError && error_.code === 'target_resource_not_found' ? t('preview.empty') : t('preview.failed')
    } finally {
      loading.value = false
    }
  }, { immediate: true })

  onBeforeUnmount(release)
</script>
