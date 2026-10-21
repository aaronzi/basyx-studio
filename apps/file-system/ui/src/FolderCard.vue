<template>
  <v-card :color="active ? 'primary' : undefined" data-test="folder-card" :variant="active ? 'tonal' : undefined">
    <v-toolbar class="cursor-pointer" @click="emit('open')">
      <template #prepend>
        <v-checkbox-btn
          v-if="editable"
          :aria-label="t('fs.select', { name: entry.name })"
          class="ms-1"
          density="compact"
          :model-value="selected"
          @click.stop
          @update:model-value="emit('toggle')"
        />

        <v-icon v-else class="ms-3" color="yellow-darken-2" icon="mdi-folder" />
      </template>

      <v-toolbar-title class="text-truncate text-title-small ms-2">{{ entry.name }}</v-toolbar-title>

      <template v-if="editable" #append>
        <entry-menu :editable="editable" :entry="entry" @action="emit('action', $event)" />
      </template>
    </v-toolbar>
  </v-card>
</template>

<script lang="ts" setup>
  import type { EntryAction, FolderEntry } from './fileSystem'
  import { computed } from 'vue'
  import EntryMenu from './EntryMenu.vue'
  import { useI18n } from './i18n'

  // A folder in the gallery, as the Web UI's FolderCard: a click opens it;
  // in edit mode it has a checkbox and a menu, and files dropped on it move
  // into it.
  const props = defineProps<{ entry: FolderEntry, editable: boolean, selected: boolean, dropTarget: boolean }>()
  const emit = defineEmits<{ open: [], toggle: [], action: [action: EntryAction] }>()
  const { t } = useI18n()

  const active = computed(() => props.selected || props.dropTarget)
</script>
