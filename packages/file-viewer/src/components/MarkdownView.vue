<template>
  <div class="flex-grow-1 overflow-y-auto pa-6" data-test="file-viewer-markdown">
    <v-progress-linear v-if="html === null" indeterminate />

    <!-- Sanitized (markdown.ts): no raw HTML, scripts, frames or remote images. -->
    <!-- eslint-disable-next-line vue/no-v-html -->
    <div v-else class="text-break" @click="onClick" v-html="html" />
  </div>
</template>

<script lang="ts" setup>
  import { ref, watch } from 'vue'
  import { VProgressLinear } from 'vuetify/components/VProgressLinear'
  import { useFileViewerContext } from '../i18n.ts'

  // Markdown rendered, read-only; its source is in the text view.
  const props = defineProps<{ text: string }>()

  const html = ref<string | null>(null)
  const { openLink } = useFileViewerContext()

  /** Links open through the host where it says how (an app's frame opens no windows); in a new tab otherwise. */
  function onClick (event: MouseEvent) {
    const link = (event.target as Element | null)?.closest('a[href]')
    const href = link?.getAttribute('href') ?? ''
    if (openLink && /^https?:/i.test(href)) {
      event.preventDefault()
      openLink(href)
    }
  }

  // markdown-it and DOMPurify load only for Markdown.
  watch(() => props.text, async text => {
    const { renderMarkdown } = await import('../markdown.ts')
    if (text === props.text) {
      html.value = renderMarkdown(text)
    }
  }, { immediate: true })
</script>
