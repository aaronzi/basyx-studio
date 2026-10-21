<template>
  <v-btn
    :aria-label="t('fs.actions')"
    data-test="entry-menu"
    icon
    size="x-small"
    @click.stop
  >
    <v-icon icon="mdi-dots-vertical" />

    <v-menu activator="parent">
      <v-list>
        <template v-if="entry.kind === 'file' && !entry.external">
          <v-list-item data-test="menu-open" prepend-icon="mdi-open-in-new" :title="t('fs.open')" @click="emit('action', 'open')" />
          <v-list-item data-test="menu-download" prepend-icon="mdi-download" :title="t('fs.download')" @click="emit('action', 'download')" />
        </template>

        <template v-if="editable">
          <v-list-item data-test="menu-rename" :prepend-icon="entry.kind === 'folder' ? 'mdi-folder-edit' : 'mdi-file-edit'" :title="t('fs.rename')" @click="emit('action', 'rename')" />
          <v-list-item data-test="menu-move" prepend-icon="mdi-folder-move" :title="t('fs.move')" @click="emit('action', 'move')" />
          <v-list-item data-test="menu-delete" prepend-icon="mdi-delete" :title="t('fs.delete')" @click="emit('action', 'delete')" />
        </template>
      </v-list>
    </v-menu>
  </v-btn>
</template>

<script lang="ts" setup>
  import type { Entry, EntryAction } from './fileSystem'
  import { useI18n } from './i18n'

  // The menu of a folder or file card, as in the Web UI: download for files,
  // and in edit mode rename, move and delete.
  defineProps<{ entry: Entry, editable: boolean }>()
  const emit = defineEmits<{ action: [action: EntryAction] }>()
  const { t } = useI18n()
</script>
