<template>
  <v-avatar :color="shell.assetKind === 'Type' ? 'warning' : 'primary'" rounded="lg" :size="size" variant="tonal">
    <v-img
      v-if="thumbnails && !failed"
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
    shell: Pick<ShellSummary, 'key' | 'idShort' | 'assetKind'>
    targetId: string
    size: string | number
    /** Whether the target serves thumbnails (`files` capability). */
    thumbnails: boolean
    iconSize?: string | number
  }>()

  // A shell without a thumbnail answers 204, which the image reports as an error.
  const failed = ref(false)
  watch(() => props.shell.key, () => (failed.value = false))
</script>
