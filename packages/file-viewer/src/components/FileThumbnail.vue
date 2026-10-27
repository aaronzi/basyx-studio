<template>
  <v-sheet
    ref="root"
    class="d-flex align-center justify-center overflow-hidden"
    color="surface-light"
    data-test="file-thumbnail"
    :height="height"
    rounded
    :width="width"
  >
    <v-img
      v-if="url && !failed"
      :alt="alt ?? source?.name ?? ''"
      class="h-100 w-100"
      :cover="cover"
      :src="url"
      @error="failed = true"
    />

    <!-- Another kind, or an image that is not there: its icon, or the host's. -->
    <slot v-else name="icon">
      <v-icon class="text-medium-emphasis" :icon="icon" :size="iconSize" />
    </slot>
  </v-sheet>
</template>

<script lang="ts" setup>
  import type { FileSource } from '../state.ts'
  import type { ComponentPublicInstance } from 'vue'
  import { computed, onBeforeUnmount, ref, useTemplateRef, watch } from 'vue'
  import { VIcon } from 'vuetify/components/VIcon'
  import { VImg } from 'vuetify/components/VImg'
  import { VSheet } from 'vuetify/components/VSheet'
  import { detectViewerKind, viewerKindIcon } from '../kinds.ts'

  // A small picture of a file for cards, lists, tiles and switchers: an
  // image scaled down, any other kind as its icon. The image is read once it
  // is in view, so a long list reads only what is seen.
  const props = withDefaults(defineProps<{
    source: FileSource | null
    width?: number | string
    height?: number | string
    /** Fills the box, cutting the image's edges; otherwise it fits inside. */
    cover?: boolean
    alt?: string
    iconSize?: number | string
  }>(), { width: undefined, height: 120, cover: false, alt: undefined, iconSize: 40 })

  const root = useTemplateRef<ComponentPublicInstance>('root')
  const url = ref('')
  const failed = ref(false)
  const visible = ref(false)

  const kind = computed(() => detectViewerKind({ contentType: props.source?.contentType, fileName: props.source?.name }))
  const icon = computed(() => viewerKindIcon(kind.value))

  function release () {
    if (url.value) {
      URL.revokeObjectURL(url.value)
    }
    url.value = ''
  }

  const observer = typeof IntersectionObserver === 'undefined'
    ? null
    : new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) {
        visible.value = true
        observer?.disconnect()
      }
    })
  watch(root, element => {
    const node = element?.$el as Element | undefined
    if (node && observer) {
      observer.observe(node)
    } else if (!observer) {
      visible.value = true
    }
  })

  let controller: AbortController | null = null
  watch([() => props.source?.key, visible], async () => {
    release()
    failed.value = false
    controller?.abort()
    const source = props.source
    if (!source || !visible.value || kind.value.kind !== 'image' || source.external) {
      return
    }
    controller = new AbortController()
    const signal = controller.signal
    try {
      const content = await source.load(signal)
      if (!signal.aborted && source.key === props.source?.key) {
        const type = kind.value.alternate === 'svg' ? 'image/svg+xml' : (source.contentType || content.contentType)
        url.value = URL.createObjectURL(new Blob([content.bytes as BlobPart], { type }))
      }
    } catch {
      failed.value = true
    }
  }, { immediate: true })

  onBeforeUnmount(() => {
    observer?.disconnect()
    controller?.abort()
    release()
  })
</script>
