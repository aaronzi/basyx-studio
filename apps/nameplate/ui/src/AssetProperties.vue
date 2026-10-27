<template>
  <v-expansion-panels v-if="groups.length > 0" v-model="panel" data-test="asset-specific-properties" static>
    <v-expansion-panel :title="t('sections.assetSpecific')" value="open">
      <v-expansion-panel-text>
        <div v-for="(group, index) in groups" :key="group.key">
          <v-divider v-if="index > 0" class="my-3" />

          <div class="d-flex align-center mb-2 text-body-small text-medium-emphasis" data-test="property-group">
            <v-icon class="me-2" :icon="group.icon" size="16" />
            {{ group.title }}
          </div>

          <DetailList :rows="group.rows" />
        </div>
      </v-expansion-panel-text>
    </v-expansion-panel>
  </v-expansion-panels>
</template>

<script lang="ts" setup>
  import type { DetailGroup } from './presentation'
  import { computed } from 'vue'
  import DetailList from './DetailList.vue'
  import { useI18n } from './i18n'

  // IDTA 02006's AssetSpecificProperties, collapsed: the properties of each
  // guideline for the declaration of conformity, and any others.
  defineProps<{ groups: DetailGroup[] }>()
  const open = defineModel<boolean>('open', { default: false })

  const { t } = useI18n()
  const panel = computed({
    get: () => (open.value ? 'open' : undefined),
    set: value => {
      open.value = value === 'open'
    },
  })
</script>
