<template>
  <section data-test="asset-specific-properties">
    <SectionHeading icon="mdi-format-list-checks" :title="t('sections.assetSpecific')">
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
    </SectionHeading>

    <!-- A table per group, below the group's name. -->
    <div v-if="open" class="d-flex flex-column ga-3">
      <div v-for="group in groups" :key="group.key">
        <div class="d-flex align-center mb-1 text-body-small text-medium-emphasis" data-test="property-group">
          <v-icon class="me-2" :icon="group.icon" size="16" />
          {{ group.title }}
        </div>

        <DetailList :rows="group.rows" />
      </div>
    </div>
  </section>
</template>

<script lang="ts" setup>
  import type { DetailGroup } from './presentation'
  import DetailList from './DetailList.vue'
  import { useI18n } from './i18n'
  import SectionHeading from './SectionHeading.vue'

  // IDTA 02006's AssetSpecificProperties, collapsed: the properties of each
  // guideline for the declaration of conformity, and any others.
  defineProps<{ groups: DetailGroup[] }>()
  const open = defineModel<boolean>('open', { default: false })

  const { t } = useI18n()
</script>
