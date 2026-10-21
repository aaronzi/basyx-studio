<template>
  <v-data-table
    class="bg-transparent border rounded-lg"
    data-test="list"
    density="compact"
    :headers="headers"
    hide-default-footer
    hover
    item-value="key"
    :items="rows"
    :items-per-page="-1"
    @click:row="(_: unknown, { item }: { item: Row }) => click(item)"
  >
    <template #[`header.select`]>
      <v-checkbox-btn
        :aria-label="t('fs.selectAll')"
        :indeterminate="selected.size > 0 && !allSelected"
        :model-value="allSelected"
        @click.stop
        @update:model-value="emit('toggle-all')"
      />
    </template>

    <template #[`item.select`]="{ item }">
      <v-checkbox-btn
        v-if="item.entry"
        :aria-label="t('fs.select', { name: item.entry.name })"
        :model-value="selected.has(item.entry.path)"
        @click.stop
        @update:model-value="emit('toggle', item.entry)"
      />
    </template>

    <template #[`item.name`]="{ item }">
      <v-list-item
        :base-color="item.target !== null && dropTarget === item.target ? 'primary' : undefined"
        class="ps-0"
        :data-test="item.entry ? 'list-entry' : 'list-up'"
        :draggable="editable && Boolean(item.entry)"
        :lines="false"
        slim
        @dragleave="item.target !== null && emit('drag-leave', item.target)"
        @dragover="item.target !== null && emit('drag-over', item.target, $event)"
        @dragstart="item.entry && emit('drag-start', item.entry, $event)"
        @drop="item.target !== null && emit('drop', item.target, $event)"
      >
        <template #prepend>
          <!-- Indented by depth; folders expand in place, as in a Finder list. -->
          <v-sheet v-if="item.depth > 0" color="transparent" :width="item.depth * 24" />

          <v-btn
            v-if="item.entry?.kind === 'folder'"
            :aria-expanded="expanded.has(item.entry.path)"
            :aria-label="t(expanded.has(item.entry.path) ? 'fs.collapse' : 'fs.expand', { name: item.entry.name })"
            class="me-1"
            data-test="expand"
            density="compact"
            :icon="expanded.has(item.entry.path) ? 'mdi-chevron-down' : 'mdi-chevron-right'"
            size="small"
            @click.stop="expand(item.entry.path)"
          />

          <v-sheet v-else color="transparent" :width="item.entry ? 32 : 0" />

          <v-icon :color="item.entry ? iconColorOf(item.entry) : 'yellow-darken-2'" :icon="item.entry ? iconOf(item.entry) : 'mdi-folder'" />
        </template>

        <v-list-item-title class="text-title-small">
          {{ item.entry?.name ?? '...' }}
          <span v-if="item.entry?.kind === 'folder'" class="text-body-small text-medium-emphasis ms-2">({{ item.entry.children.length }})</span>
        </v-list-item-title>
      </v-list-item>
    </template>

    <template #[`item.type`]="{ item }">
      <template v-if="item.entry?.kind === 'folder'">{{ t('fs.folder') }}</template>
      <template v-else-if="item.entry">.{{ extensionOf(item.entry) }}</template>
    </template>

    <template #[`item.actions`]="{ item }">
      <div v-if="item.entry" class="d-flex ga-1 justify-end">
        <v-btn
          v-if="editable && item.entry.parent"
          :aria-label="t('fs.moveUp')"
          data-test="move-up"
          :disabled="selected.size > 0"
          icon="mdi-arrow-up-bold"
          size="small"
          @click.stop="emit('action', item.entry, 'moveUp')"
        />

        <v-btn
          v-if="editable"
          :aria-label="t('fs.rename')"
          data-test="rename"
          :disabled="selected.size > 0"
          icon="mdi-pencil"
          size="small"
          @click.stop="emit('action', item.entry, 'rename')"
        />

        <v-btn
          v-if="item.entry.kind === 'file' && !item.entry.external"
          :aria-label="t('fs.download')"
          data-test="download"
          icon="mdi-tray-arrow-down"
          size="small"
          @click.stop="emit('action', item.entry, 'download')"
        />

        <v-btn
          v-if="editable"
          :aria-label="t('fs.delete')"
          data-test="delete"
          :disabled="selected.size > 0"
          icon="mdi-delete"
          size="small"
          @click.stop="emit('action', item.entry, 'delete')"
        />
      </div>
    </template>
  </v-data-table>
</template>

<script lang="ts" setup>
  import type { Entry, EntryAction, FileEntry } from './fileSystem'
  import { computed, ref, watch } from 'vue'
  import { extensionOf as extensionOfType, iconColorOf, iconOf, parentOf } from './fileSystem'
  import { useI18n } from './i18n'

  // The Web UI's list view: name, type and actions per row, `...` to go up,
  // and in edit mode checkboxes to select several. As in a Finder list, a
  // folder's chevron shows its content below it, indented; a click on the
  // row opens the folder.
  const props = defineProps<{
    entries: Entry[]
    folder: string
    editable: boolean
    selected: ReadonlySet<string>
    dropTarget: string | null
  }>()
  const emit = defineEmits<{
    'open': [path: string]
    'preview': [entry: FileEntry]
    'toggle': [entry: Entry]
    'toggle-all': []
    'action': [entry: Entry, action: EntryAction | 'moveUp']
    'drag-start': [entry: Entry, event: DragEvent]
    'drag-over': [path: string, event: DragEvent]
    'drag-leave': [path: string]
    'drop': [path: string, event: DragEvent]
  }>()
  const { t } = useI18n()

  /**
   * A row: an entry at a depth below the folder shown, or `...` for the
   * folder above; `target` is where a drop on it moves to.
   */
  interface Row { key: string, entry: Entry | null, target: string | null, depth: number }

  /** Folders shown expanded, by path. */
  const expanded = ref<Set<string>>(new Set())
  // Another folder starts collapsed.
  watch(() => props.folder, () => (expanded.value = new Set()))

  function expand (path: string) {
    const next = new Set(expanded.value)
    if (next.has(path)) {
      next.delete(path)
    } else {
      next.add(path)
    }
    expanded.value = next
  }

  function rowsOf (entries: Entry[], depth: number): Row[] {
    return entries.flatMap(entry => [
      { key: entry.path, entry, target: entry.kind === 'folder' ? entry.path : null, depth },
      ...(entry.kind === 'folder' && expanded.value.has(entry.path) ? rowsOf(entry.children, depth + 1) : []),
    ])
  }

  const rows = computed<Row[]>(() => [
    ...(props.folder ? [{ key: '..', entry: null, target: parentOf(props.folder), depth: 0 }] : []),
    ...rowsOf(props.entries, 0),
  ])
  const allSelected = computed(() => props.entries.length > 0 && props.entries.every(entry => props.selected.has(entry.path)))
  const headers = computed(() => [
    ...(props.editable ? [{ key: 'select', sortable: false, width: 48 }] : []),
    { title: t('fs.name'), key: 'name', sortable: false },
    { title: t('fs.type'), key: 'type', sortable: false },
    { title: t('fs.actions'), key: 'actions', sortable: false, align: 'end' as const },
  ])

  function extensionOf (entry: FileEntry): string {
    const fromName = entry.fileName.includes('.') ? entry.fileName.split('.').pop() : null
    return fromName || extensionOfType(entry.contentType)
  }

  function click (row: Row) {
    if (!row.entry) {
      emit('open', row.target ?? '')
    } else if (row.entry.kind === 'folder') {
      emit('open', row.entry.path)
    } else {
      emit('preview', row.entry)
    }
  }
</script>
