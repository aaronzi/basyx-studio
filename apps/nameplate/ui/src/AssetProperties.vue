<template>
  <SectionCard data-test="asset-specific-properties" icon="mdi-format-list-checks" :title="t('sections.assetSpecific')">
    <template #actions>
      <v-btn
        :aria-expanded="open"
        :aria-label="t(open ? 'assetSpecific.collapse' : 'assetSpecific.expand')"
        data-test="asset-specific-toggle"
        :icon="open ? 'mdi-chevron-up' : 'mdi-chevron-down'"
        size="small"
        @click="open = !open"
      />
    </template>

    <template v-if="open">
      <div v-for="(group, index) in groups" :key="group.key">
        <v-divider v-if="index > 0" />

        <div class="d-flex align-center px-4 py-2 text-body-small text-medium-emphasis" data-test="property-group">
          <v-icon class="me-2" :icon="group.icon" size="16" />
          {{ group.title }}
        </div>

        <DetailList :rows="group.rows" />
      </div>
    </template>
  </SectionCard>
</template>

<script lang="ts" setup>
  import type { DetailGroup } from './presentation'
  import DetailList from './DetailList.vue'
  import { useI18n } from './i18n'
  import SectionCard from './SectionCard.vue'

  // IDTA 02006's AssetSpecificProperties, collapsed: the properties of each
  // guideline for the declaration of conformity, and any others.
  defineProps<{ groups: DetailGroup[] }>()
  const open = defineModel<boolean>('open', { default: false })

  const { t } = useI18n()
</script>
