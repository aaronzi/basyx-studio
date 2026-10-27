<template>
  <div class="flex-grow-1 overflow-y-auto pa-6" data-test="file-viewer-markdown">
    <v-progress-linear v-if="html === null" indeterminate />

    <!-- Sanitized (markdown.ts): no raw HTML, scripts, frames or remote images. -->
    <!-- eslint-disable-next-line vue/no-v-html -->
    <div v-else class="text-break" v-html="html" />
  </div>
</template>

<script lang="ts" setup>
  import { ref, watch } from 'vue'
  import { VProgressLinear } from 'vuetify/components/VProgressLinear'

  // Markdown rendered, read-only; its source is in the text view.
  const props = defineProps<{ text: string }>()

  const html = ref<string | null>(null)

  // markdown-it and DOMPurify load only for Markdown.
  watch(() => props.text, async text => {
    const { renderMarkdown } = await import('../markdown.ts')
    if (text === props.text) {
      html.value = renderMarkdown(text)
    }
  }, { immediate: true })
</script>
