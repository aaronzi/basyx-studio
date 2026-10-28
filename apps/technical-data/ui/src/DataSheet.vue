<template>
  <v-table-sheet data-test="data-sheet">
    <thead class="bg-card-header">
      <tr>
        <th class="w-50">{{ t('sheet.property') }}</th>
        <th class="w-25">{{ t('sheet.value') }}</th>
        <th>{{ t('sheet.unit') }}</th>
      </tr>
    </thead>

    <tbody>
      <template v-for="sheet in sheets" :key="sheet.path">
        <!-- Each area heads its properties, where there are several. -->
        <tr
          v-if="grouped"
          :id="areaAnchor(sheet.path)"
          class="bg-card-header"
          data-test="sheet-area"
        >
          <td class="py-2" colspan="3">
            <div class="d-flex align-center ga-2 text-title-small">
              <v-icon :icon="icon" size="18" />
              {{ sheet.title }}
            </div>
          </td>
        </tr>

        <tr
          v-for="row in sheet.rows"
          :key="row.key"
          :class="{ 'bg-card-header': row.kind === 'section' }"
          :data-field="row.field?.path"
          :data-test="row.kind === 'section' ? 'sheet-section' : 'sheet-row'"
        >
          <!-- A section heads its elements, which are indented below it. -->
          <td
            v-if="row.kind === 'section'"
            class="py-2"
            :class="indent(row.depth)"
            colspan="3"
          >
            <div class="d-flex align-center ga-2 font-weight-medium" data-test="sheet-section-label">
              <v-icon class="text-medium-emphasis" icon="mdi-folder-outline" size="16" />
              {{ row.label }}
              <v-icon
                v-if="row.definition"
                v-tooltip="row.definition"
                :aria-label="row.definition"
                class="text-medium-emphasis"
                icon="mdi-information-outline"
                role="img"
                size="14"
              />
            </div>
          </td>

          <template v-else>
            <td class="text-medium-emphasis align-top py-2" :class="indent(row.depth)" data-test="sheet-label">
              {{ row.label }}
              <v-icon
                v-if="row.definition"
                v-tooltip="row.definition"
                :aria-label="row.definition"
                class="ms-1"
                icon="mdi-information-outline"
                role="img"
                size="14"
              />
            </td>

            <td class="align-top py-2 text-break" :colspan="editing(row) ? 2 : 1">
              <FieldEditForm v-if="editing(row)" />

              <div v-else class="d-flex align-start ga-1">
                <div class="flex-grow-1 font-weight-medium" data-test="sheet-value">
                  <v-btn-link
                    v-if="row.file"
                    append-icon="mdi-eye-outline"
                    data-test="sheet-file"
                    :text="row.value"
                    @click="preview?.(row.file)"
                  />

                  <template v-else-if="row.value">{{ row.value }}</template>

                  <span v-else class="text-medium-emphasis">—</span>
                </div>

                <v-btn
                  v-if="canEdit && row.field"
                  :aria-label="t('edit.edit', { label: row.label })"
                  data-test="edit"
                  icon
                  size="x-small"
                  @click="editor.start(row.field, row.label)"
                >
                  <v-icon icon="mdi-pencil-outline" size="14" />
                  <v-tooltip activator="parent" location="bottom" :text="t('edit.edit', { label: row.label })" />
                </v-btn>
              </div>
            </td>

            <td v-if="!editing(row)" class="align-top py-2 text-no-wrap" data-test="sheet-unit">{{ row.unit }}</td>
          </template>
        </tr>
      </template>
    </tbody>
  </v-table-sheet>
</template>

<script lang="ts" setup>
  import type { SheetRow } from './presentation'
  import { useRowActions } from '@basyx/studio-app-kit/editing'
  import FieldEditForm from './FieldEditForm.vue'
  import { useI18n } from './i18n'
  import { areaAnchor } from './presentation'

  // Areas of technical properties (or specific descriptions) as one data
  // sheet, as the BaSyx AAS Web UI's table view: property, value and unit in
  // columns, areas and sections as tinted rows heading their elements, nested
  // ones indented, what a property means in a tooltip.
  const props = defineProps<{
    sheets: Array<{ path: string, title: string, rows: SheetRow[] }>
    /** Whether areas get rows of their own: where there are several, also when a search shows one. */
    grouped: boolean
    icon: string
  }>()

  const { t } = useI18n()
  const { canEdit, editor, preview } = useRowActions()

  const indents = ['ps-4', 'ps-8', 'ps-12', 'ps-16']

  /** Below an area's row, its elements one step in. */
  function indent (depth: number): string {
    return indents[Math.min(depth + (props.grouped ? 1 : 0), indents.length - 1)]!
  }

  function editing (row: SheetRow): boolean {
    return editor.draft.value !== null && editor.draft.value.field.path === row.field?.path
  }
</script>
