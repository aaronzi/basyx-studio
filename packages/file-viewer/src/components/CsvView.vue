<template>
  <div class="d-flex flex-column flex-grow-1 overflow-hidden" data-test="file-viewer-csv">
    <v-alert
      v-if="table.truncated"
      class="ma-2 flex-shrink-0"
      density="compact"
      :text="t('table.truncated', { count: csvRowLimit })"
      type="info"
    />

    <v-empty-state v-if="table.rows.length === 0" icon="mdi-table-off" size="56" :title="t('table.empty')" />

    <v-data-table-virtual
      v-else
      class="flex-grow-1"
      fixed-header
      :headers="headers"
      height="100%"
      hide-default-footer
      :items="items"
    />
  </div>
</template>

<script lang="ts" setup>
  import { computed } from 'vue'
  import { VAlert } from 'vuetify/components/VAlert'
  import { VDataTableVirtual } from 'vuetify/components/VDataTable'
  import { VEmptyState } from 'vuetify/components/VEmptyState'
  import { csvRowLimit, parseCsv } from '../csv.ts'
  import { useFileViewerContext } from '../i18n.ts'

  // CSV and TSV as a table: the first row as headers, the delimiter as the
  // file uses it (or as a TSV declares it).
  const props = defineProps<{ text: string, delimiter: string | null }>()

  const { t } = useFileViewerContext()

  const table = computed(() => parseCsv(props.text, props.delimiter))
  const width = computed(() => Math.max(0, ...table.value.rows.map(row => row.length)))
  const headers = computed(() => Array.from({ length: width.value }, (_, index) => ({
    key: `c${index}`,
    title: table.value.rows[0]?.[index] || `${index + 1}`,
    sortable: false,
  })))
  const items = computed(() => table.value.rows.slice(1).map(row => Object.fromEntries(row.map((value, index) => [`c${index}`, value]))))
</script>
