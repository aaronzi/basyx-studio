<template>
  <div data-test="file-preview">
    <v-alert v-if="file.external" data-test="external-file" :text="t('preview.external', { url: file.external })" type="info" />

    <v-progress-linear v-else-if="loading" />

    <v-alert v-else-if="error" data-test="preview-error" :text="error" type="warning" />

    <template v-else-if="content">
      <v-img
        v-if="kind === 'image'"
        :alt="file.name"
        class="border rounded"
        data-test="image-preview"
        :max-height="fullscreen ? undefined : 480"
        :src="url"
      />

      <pdf-preview v-else-if="kind === 'pdf'" :bytes="content.bytes" />

      <template v-else-if="kind === 'text'">
        <v-code class="d-block text-pre-wrap text-break overflow-auto pa-3" data-test="text-preview">{{ text }}</v-code>
        <p v-if="truncated" class="text-caption text-medium-emphasis mt-1">{{ t('preview.truncated', { size: formatSize(textLimit, locale) }) }}</p>
      </template>

      <video
        v-else-if="kind === 'video'"
        class="d-block w-100 rounded"
        controls
        data-test="video-preview"
        :src="url"
      />

      <audio
        v-else-if="kind === 'audio'"
        class="d-block w-100"
        controls
        data-test="audio-preview"
        :src="url"
      />
    </template>

    <div v-if="!file.external && kind === 'none'" class="d-flex flex-column align-center text-medium-emphasis pa-6" data-test="no-preview">
      <v-icon :icon="iconOf(file)" size="48" />
      <p class="text-body-2 mt-2">{{ t('preview.none') }}</p>
    </div>
  </div>
</template>

<script lang="ts" setup>
  import type { FileEntry } from './fileSystem'
  import type { FileContent, StudioClient } from '@basyx/studio-sdk'
  import { StudioError } from '@basyx/studio-sdk'
  import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
  import { formatSize, iconOf, previewKind } from './fileSystem'
  import { useI18n } from './i18n'
  import PdfPreview from './PdfPreview.vue'

  // The selected file's content, read through Studio (`studio.ui.readFile`):
  // images, PDFs, text, audio and video; other files are opened or
  // downloaded with the buttons above the preview.
  const props = defineProps<{ client: StudioClient, submodelId: string, file: FileEntry, locale: string, fullscreen: boolean }>()
  const emit = defineEmits<{ loaded: [size: number] }>()
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

  watch(() => [props.file.path, props.file.element] as const, async () => {
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
      emit('loaded', read.bytes.byteLength)
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
