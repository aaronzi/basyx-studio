<template>
  <!-- IFC: the picked element's attributes and property sets. -->
  <v-card v-if="viewer.result.value?.pickable" data-test="model-view-element">
    <v-progress-linear v-if="viewer.selecting.value" indeterminate />

    <template v-else-if="viewer.selected.value">
      <v-card-item
        :subtitle="[viewer.selected.value.type, viewer.selected.value.globalId].filter(Boolean).join(' · ')"
        :title="viewer.selected.value.name ?? viewer.selected.value.type"
      >
        <template #append>
          <v-btn :aria-label="t('model3d.clearSelection')" icon="mdi-close" size="small" @click="viewer.clearSelection()" />
        </template>
      </v-card-item>

      <v-expansion-panels v-if="viewer.selected.value.groups.length > 0" multiple static variant="accordion">
        <v-expansion-panel v-for="group in viewer.selected.value.groups" :key="group.name" :title="group.name">
          <v-expansion-panel-text>
            <v-table class="bg-transparent" density="compact">
              <tbody>
                <tr v-for="property in group.properties" :key="`${property.name}:${property.value}`">
                  <td class="text-medium-emphasis text-no-wrap align-top py-1">{{ property.name }}</td>
                  <td class="text-break align-top py-1">{{ property.value }}</td>
                </tr>
              </tbody>
            </v-table>
          </v-expansion-panel-text>
        </v-expansion-panel>
      </v-expansion-panels>

      <v-card-text v-else class="text-medium-emphasis">{{ t('model3d.noProperties') }}</v-card-text>
    </template>

    <v-card-text v-else class="text-medium-emphasis">{{ t('model3d.pickHint') }}</v-card-text>
  </v-card>
</template>

<script lang="ts" setup>
  import type { ModelView } from '../model-view.ts'
  import { VBtn } from 'vuetify/components/VBtn'
  import { VCard, VCardItem, VCardText } from 'vuetify/components/VCard'
  import { VExpansionPanel, VExpansionPanels, VExpansionPanelText } from 'vuetify/components/VExpansionPanel'
  import { VProgressLinear } from 'vuetify/components/VProgressLinear'
  import { VTable } from 'vuetify/components/VTable'
  import { useFileViewerContext } from '../i18n.ts'

  // The IFC element picked in the 3D view, as the 3D Models app shows it:
  // its type and GlobalId, then its property sets as label and value rows.
  const props = defineProps<{ view: ModelView }>()

  const { t } = useFileViewerContext()
  const viewer = props.view.viewer
</script>
