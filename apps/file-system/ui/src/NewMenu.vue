<template>
  <v-menu>
    <template #activator="{ props: menuProps }">
      <v-btn-primary data-test="new" prepend-icon="mdi-plus" :text="t('fs.new')" v-bind="menuProps" />
    </template>

    <v-list>
      <v-list-item data-test="create-folder" prepend-icon="mdi-folder-plus" :title="t('fs.createFolder')" @click="emit('create-folder')" />
      <v-list-item data-test="upload" prepend-icon="mdi-file-upload" :title="t('fs.uploadFiles')" @click="emit('upload')" />
    </v-list>
  </v-menu>
</template>

<script lang="ts" setup>
  import { useI18n } from './i18n'

  // The Web UI's "New" menu: a folder, or files to upload.
  const emit = defineEmits<{ 'create-folder': [], 'upload': [] }>()
  const { t } = useI18n()
</script>
