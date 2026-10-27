<template>
  <v-table-details>
    <tbody>
      <tr v-for="entry in rows" :key="`${entry.label}:${entry.value}`">
        <td class="text-medium-emphasis text-no-wrap align-top py-1">
          <v-icon v-if="entry.icon" class="me-2" :icon="entry.icon" size="16" />
          {{ entry.label }}
        </td>

        <td class="text-break align-top py-1">
          <!-- The frame cannot open links itself: Studio opens addresses in the
               browser and shells on its own page; documents are selected here. -->
          <v-btn-link
            v-if="entry.url || entry.document || entry.shell"
            :append-icon="entry.document ? 'mdi-arrow-right' : 'mdi-open-in-new'"
            data-test="definition-link"
            :text="entry.value"
            @click="emit('open', entry)"
          />

          <template v-else>{{ entry.value }}</template>
        </td>
      </tr>
    </tbody>
  </v-table-details>
</template>

<script lang="ts" setup>
  import type { DetailRow } from './presentation'

  // Label and value rows; the Web UI's definition list as a Vuetify table.
  defineProps<{ rows: DetailRow[] }>()
  const emit = defineEmits<{ open: [row: DetailRow] }>()
</script>
