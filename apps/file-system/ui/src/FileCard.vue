<template>
  <v-card :color="selected ? 'primary' : undefined" data-test="file-card" :variant="selected ? 'tonal' : undefined">
    <v-toolbar class="cursor-pointer" @click="emit('preview')">
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

        <v-icon v-else class="ms-3" :color="iconColorOf(entry)" :icon="iconOf(entry)" />
      </template>

      <v-toolbar-title class="text-truncate text-title-small ms-2">{{ entry.name }}</v-toolbar-title>

      <template v-if="!entry.external || editable" #append>
        <entry-menu :editable="editable" :entry="entry" @action="emit('action', $event)" />
      </template>
    </v-toolbar>

    <v-card-item class="px-2 pb-2 pt-0 cursor-pointer" @click="emit('preview')">
      <v-card>
        <v-img
          v-if="thumbnail"
          :alt="entry.name"
          :aspect-ratio="16 / 9"
          cover
          :src="thumbnail"
        />

        <v-responsive v-else :aspect-ratio="16 / 9">
          <div class="d-flex align-center justify-center h-100">
            <v-icon :color="iconColorOf(entry)" :icon="iconOf(entry)" size="large" />
          </div>
        </v-responsive>
      </v-card>
    </v-card-item>
  </v-card>
</template>

<script lang="ts" setup>
  import type { EntryAction, FileEntry } from './fileSystem'
  import EntryMenu from './EntryMenu.vue'
  import { iconColorOf, iconOf } from './fileSystem'
  import { useI18n } from './i18n'

  // A file in the gallery, as the Web UI's FileCard: its name and menu above
  // a 16:9 thumbnail (images) or its type's icon; a click previews it.
  defineProps<{ entry: FileEntry, editable: boolean, selected: boolean, thumbnail: string | null }>()
  const emit = defineEmits<{ preview: [], toggle: [], action: [action: EntryAction] }>()
  const { t } = useI18n()
</script>
