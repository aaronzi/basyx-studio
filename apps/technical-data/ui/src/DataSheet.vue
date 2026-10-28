<template>
  <v-table-details data-test="data-sheet">
    <thead>
      <tr>
        <th class="w-50">{{ t('sheet.property') }}</th>
        <th>{{ t('sheet.value') }}</th>
        <th>{{ t('sheet.unit') }}</th>
      </tr>
    </thead>

    <tbody>
      <tr
        v-for="row in rows"
        :key="row.key"
        :data-field="row.field?.path"
        :data-test="row.kind === 'section' ? 'sheet-section' : 'sheet-row'"
      >
        <!-- A section heads its elements, which are indented below it. -->
        <td
          v-if="row.kind === 'section'"
          class="font-weight-medium py-2"
          :class="indent(row.depth)"
          colspan="3"
        >
          {{ row.label }}
          <v-icon
            v-if="row.definition"
            v-tooltip="row.definition"
            :aria-label="row.definition"
            class="ms-1 text-medium-emphasis"
            icon="mdi-information-outline"
            role="img"
            size="14"
          />
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
                v-if="row.copy && !canEdit"
                :aria-label="t('copy.copy', { label: row.label })"
                data-test="sheet-copy"
                icon
                size="x-small"
                @click="copy(row.copy)"
              >
                <v-icon icon="mdi-content-copy" size="14" />
                <v-tooltip activator="parent" location="bottom" :text="t('copy.copy', { label: row.label })" />
              </v-btn>

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
    </tbody>
  </v-table-details>
</template>

<script lang="ts" setup>
  import type { SheetRow } from './presentation'
  import { useRowActions } from '@basyx/studio-app-kit/editing'
  import FieldEditForm from './FieldEditForm.vue'
  import { useI18n } from './i18n'

  // An area's data sheet, as a manufacturer's data sheet reads: property,
  // value and unit in columns, sections as rows heading their elements,
  // nested ones indented; what a property means in a tooltip.
  defineProps<{ rows: SheetRow[] }>()

  const { t } = useI18n()
  const { canEdit, editor, copy, preview } = useRowActions()

  const indents = ['ps-4', 'ps-8', 'ps-12', 'ps-16']

  function indent (depth: number): string {
    return indents[Math.min(depth, indents.length - 1)]!
  }

  function editing (row: SheetRow): boolean {
    return editor.draft.value !== null && editor.draft.value.field.path === row.field?.path
  }
</script>
