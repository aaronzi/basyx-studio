<template>
  <v-dialog
    fullscreen
    :model-value="dialog.state !== null"
    @update:model-value="open => open || dialog.close()"
  >
    <v-card-fullscreen class="d-flex flex-column" data-test="file-viewer-dialog" height="100%">
      <FileViewer v-if="dialog.state" fullscreen :state="dialog.state" @close="dialog.close()" />
    </v-card-fullscreen>
  </v-dialog>
</template>

<script lang="ts" setup>
  import { FileViewer } from '@basyx/file-viewer/viewer'

  // The one full-screen file viewer, over every page (layouts/default.vue);
  // Escape closes it.
  const dialog = useFileViewerDialogStore()
</script>
