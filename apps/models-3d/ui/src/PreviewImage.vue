<template>
  <FileThumbnail
    :alt="alt"
    :cover="!contain"
    height="100%"
    :source="source"
    width="100%"
  >
    <template #icon>
      <v-icon class="text-medium-emphasis" icon="mdi-cube-outline" :size="iconSize" />
    </template>
  </FileThumbnail>
</template>

<script lang="ts" setup>
  import type { FileRef } from './models3d'
  import type { FileSource } from '@basyx/file-viewer/vue'
  import type { StudioClient } from '@basyx/studio-sdk'
  import { FileThumbnail, withCachedContent } from '@basyx/file-viewer/vue'
  import { computed } from 'vue'

  // A version's preview image (PNG, JPG or BMP, IDTA 02026), read through
  // Studio once it is in view (the file viewer's thumbnail, ADR 0052); the
  // cube icon where there is none.
  const props = withDefaults(defineProps<{
    client: StudioClient
    submodelId: string
    file: FileRef | null
    alt?: string
    contain?: boolean
    iconSize?: string | number
  }>(), { alt: '', contain: false, iconSize: 'large' })

  const source = computed<FileSource | null>(() => {
    const file = props.file
    if (!file) {
      return null
    }
    return withCachedContent({
      key: `${file.path}:${file.value}`,
      name: file.value.split('/').pop() ?? '',
      contentType: file.contentType,
      load: () => props.client.ui.readFile(props.submodelId, file.path),
    })
  })
</script>
