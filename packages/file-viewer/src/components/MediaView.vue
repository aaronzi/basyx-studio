<template>
  <div class="d-flex flex-grow-1 align-center justify-center overflow-hidden pa-4" data-test="file-viewer-media">
    <v-alert v-if="failed" :text="t('media.failed')" type="warning" />

    <video
      v-else-if="kind === 'video' && url"
      class="w-100 h-100"
      controls
      :src="url"
      @error="failed = true"
    />

    <audio
      v-else-if="url"
      class="w-100"
      controls
      :src="url"
      @error="failed = true"
    />
  </div>
</template>

<script lang="ts" setup>
  import type { FileContent } from '../state.ts'
  import { onBeforeUnmount, ref, watch } from 'vue'
  import { VAlert } from 'vuetify/components/VAlert'
  import { useFileViewerContext } from '../i18n.ts'

  // Audio and video in the browser's own player.
  const props = defineProps<{ content: FileContent, kind: 'video' | 'audio', type: string }>()

  const { t } = useFileViewerContext()
  const url = ref('')
  const failed = ref(false)

  function release () {
    if (url.value) {
      URL.revokeObjectURL(url.value)
    }
    url.value = ''
  }

  watch(() => props.content, content => {
    release()
    failed.value = false
    url.value = URL.createObjectURL(new Blob([content.bytes as BlobPart], { type: props.type || content.contentType }))
  }, { immediate: true })

  onBeforeUnmount(release)
</script>
