<template>
  <div class="d-flex flex-grow-1 align-center justify-center overflow-hidden pa-4" data-test="file-viewer-image">
    <v-alert v-if="failed" :text="t('image.failed')" type="warning" />

    <!-- An SVG as an image: the browser runs none of its scripts. -->
    <v-img
      v-else-if="url"
      :alt="name"
      class="h-100 w-100"
      :src="url"
      @error="failed = true"
    />
  </div>
</template>

<script lang="ts" setup>
  import type { FileContent } from '../state.ts'
  import { onBeforeUnmount, ref, watch } from 'vue'
  import { VAlert } from 'vuetify/components/VAlert'
  import { VImg } from 'vuetify/components/VImg'
  import { useFileViewerContext } from '../i18n.ts'

  // An image from its bytes. The type is the file's when the bytes are an
  // SVG, as a host may send one as text/plain.
  const props = defineProps<{ content: FileContent, name: string, svg: boolean }>()

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
    const type = props.svg ? 'image/svg+xml' : (content.contentType.startsWith('image/') ? content.contentType : '')
    url.value = URL.createObjectURL(new Blob([content.bytes as BlobPart], type ? { type } : {}))
  }, { immediate: true })

  onBeforeUnmount(release)
</script>
