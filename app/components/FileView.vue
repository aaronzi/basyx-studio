<template>
  <FileViewer maximizable min-height="360" :state="state" @maximize="dialog.open(state)" />
</template>

<script lang="ts" setup>
  import type { FileViewerState } from '@basyx/file-viewer/vue'
  import { FileViewer } from '@basyx/file-viewer/viewer'

  // Studio's file view in the Visualization tab (ADR 0052): the selected File
  // or Blob in the whole height of the drawer; maximize shows the same state
  // full-screen.
  defineProps<{ state: FileViewerState }>()

  const dialog = useFileViewerDialogStore()
</script>
