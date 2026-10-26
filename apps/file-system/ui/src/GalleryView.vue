<template>
  <v-empty-state
    v-if="entries.length === 0 && !folder"
    data-test="empty"
    icon="mdi-folder-open-outline"
    :text="editable ? t('fs.emptyEdit') : undefined"
    :title="t('fs.emptyTitle')"
  >
    <template v-if="editable" #actions>
      <new-menu @create-folder="emit('create-folder')" @upload="emit('upload')" />
    </template>
  </v-empty-state>

  <template v-else>
    <v-row v-if="folder || folders.length > 0" data-test="folders" dense>
      <!-- Up one level, also a drop target -->
      <v-col
        v-if="folder"
        cols="12"
        lg="3"
        md="4"
        sm="6"
      >
        <v-card
          :color="dropTarget === parent ? 'primary' : undefined"
          data-test="navigate-up"
          :variant="dropTarget === parent ? 'tonal' : undefined"
          @dragleave="emit('drag-leave', parent)"
          @dragover="emit('drag-over', parent, $event)"
          @drop="emit('drop', parent, $event)"
        >
          <v-toolbar
            class="cursor-pointer"
            title="..."
            @click="emit('open', parent)"
          />
        </v-card>
      </v-col>

      <v-col
        v-for="entry in folders"
        :key="entry.path"
        cols="12"
        lg="3"
        md="4"
        sm="6"
      >
        <folder-card
          :draggable="editable"
          :drop-target="dropTarget === entry.path"
          :editable="editable"
          :entry="entry"
          :selected="selected.has(entry.path)"
          @action="emit('action', entry, $event)"
          @dragleave="emit('drag-leave', entry.path)"
          @dragover="emit('drag-over', entry.path, $event)"
          @dragstart="emit('drag-start', entry, $event)"
          @drop="emit('drop', entry.path, $event)"
          @open="emit('open', entry.path)"
          @toggle="emit('toggle', entry)"
        />
      </v-col>
    </v-row>

    <v-row v-if="files.length > 0" class="mt-2" data-test="files" dense>
      <v-col
        v-for="entry in files"
        :key="entry.path"
        cols="12"
        lg="3"
        md="4"
        sm="6"
      >
        <file-card
          :draggable="editable"
          :editable="editable"
          :entry="entry"
          :selected="selected.has(entry.path)"
          :source="sources[entry.path] ?? null"
          @action="emit('action', entry, $event)"
          @dragstart="emit('drag-start', entry, $event)"
          @preview="emit('preview', entry)"
          @toggle="emit('toggle', entry)"
        />
      </v-col>
    </v-row>

    <p v-if="entries.length === 0" class="text-body-medium text-medium-emphasis mt-4" data-test="folder-empty">{{ t('fs.folderEmpty') }}</p>
  </template>
</template>

<script lang="ts" setup>
  import type { Entry, EntryAction, FileEntry, FolderEntry } from './fileSystem'
  import type { FileSource } from '@basyx/file-viewer/vue'
  import { computed } from 'vue'
  import FileCard from './FileCard.vue'
  import { parentOf } from './fileSystem'
  import FolderCard from './FolderCard.vue'
  import { useI18n } from './i18n'
  import NewMenu from './NewMenu.vue'

  // The Web UI's gallery: the folder's subfolders as cards in a row, with
  // `...` to go up, and its files as cards with thumbnails below them.
  const props = defineProps<{
    entries: Entry[]
    folder: string
    editable: boolean
    selected: ReadonlySet<string>
    dropTarget: string | null
    sources: Record<string, FileSource>
  }>()
  const emit = defineEmits<{
    'open': [path: string]
    'preview': [entry: FileEntry]
    'toggle': [entry: Entry]
    'action': [entry: Entry, action: EntryAction]
    'create-folder': []
    'upload': []
    'drag-start': [entry: Entry, event: DragEvent]
    'drag-over': [path: string, event: DragEvent]
    'drag-leave': [path: string]
    'drop': [path: string, event: DragEvent]
  }>()
  const { t } = useI18n()

  const parent = computed(() => parentOf(props.folder))
  const folders = computed(() => props.entries.filter((entry): entry is FolderEntry => entry.kind === 'folder'))
  const files = computed(() => props.entries.filter((entry): entry is FileEntry => entry.kind === 'file'))
</script>
