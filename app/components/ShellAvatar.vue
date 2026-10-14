<template>
  <v-avatar :color="shell.assetKind === 'Type' ? 'warning' : 'primary'" :size="size" variant="tonal">
    <v-img
      v-if="showImage"
      :alt="shell.idShort ?? ''"
      cover
      :src="`${apiBasePath}/targets/${targetId}/shells/${shell.key}/thumbnail`"
      @error="failed = true"
    />

    <v-icon v-else :icon="shell.assetKind === 'Type' ? 'mdi-shape-outline' : 'mdi-cube-outline'" :size="iconSize" />
  </v-avatar>
</template>

<script lang="ts" setup>
  import type { ShellSummary } from '#shared/contract'
  import { apiBasePath } from '#shared/contract'

  const props = defineProps<{
    shell: Pick<ShellSummary, 'key' | 'idShort' | 'assetKind' | 'thumbnail'>
    targetId: string
    size: string | number
    /** Whether the target serves thumbnails (`files` capability). */
    thumbnails: boolean
    iconSize?: string | number
  }>()

  // The image is requested only for shells that name a thumbnail, and only
  // after mounting: an image that loads or fails while the page hydrates
  // would report it before Vuetify listens, and the avatar would stay empty.
  const mounted = ref(false)
  const failed = ref(false)
  onMounted(() => (mounted.value = true))
  watch(() => props.shell.key, () => (failed.value = false))
  const showImage = computed(() => mounted.value && props.thumbnails && props.shell.thumbnail && !failed.value)
</script>
