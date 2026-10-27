<template>
  <div class="d-flex align-start ga-4" data-test="nameplate-header">
    <PreviewImage
      v-if="nameplate.logo"
      :alt="t('nameplate.logo', { name: heading.manufacturer || heading.title })"
      :client="client"
      data-test="company-logo"
      :file="nameplate.logo"
      height="64"
      icon="mdi-factory"
      :submodel-id="submodelId"
      width="128"
    />

    <div class="flex-grow-1">
      <div class="text-title-medium text-break" data-test="product-title">{{ heading.title }}</div>

      <div v-if="heading.manufacturer" class="text-body-medium" data-test="manufacturer-name">{{ heading.manufacturer }}</div>

      <div v-if="heading.details" class="text-body-small text-medium-emphasis" data-test="product-details">{{ heading.details }}</div>

      <div class="d-flex flex-wrap align-center ga-2 mt-2">
        <v-chip
          v-for="marking in markings"
          :key="marking.path"
          :aria-label="t('marking.open', { name: marking.name })"
          :color="marking.expired ? 'error' : undefined"
          data-test="marking-chip"
          :prepend-icon="marking.expired ? 'mdi-alert-decagram-outline' : 'mdi-check-decagram-outline'"
          :text="marking.name"
          @click="emit('open', marking.marking)"
        />

        <v-chip data-test="template-version" :text="templateLabel(nameplate.version)" variant="outlined" />
      </div>
    </div>

    <slot />
  </div>
</template>

<script lang="ts" setup>
  import type { Marking, Nameplate } from './nameplate'
  import type { StudioClient } from '@basyx/studio-sdk'
  import { computed } from 'vue'
  import { useI18n } from './i18n'
  import { headline, markingExpired, markingName, templateLabel } from './presentation'
  import PreviewImage from './PreviewImage.vue'

  // The product at a glance: the manufacturer's logo, the product's
  // designation, manufacturer, type and serial number, its markings and the
  // template version, each marking opening its details; the default slot
  // takes the full-screen button.
  const props = defineProps<{ client: StudioClient, submodelId: string, nameplate: Nameplate }>()
  const emit = defineEmits<{ open: [marking: Marking] }>()

  const { t, formatLocale } = useI18n()
  const heading = computed(() => headline(t, props.nameplate, formatLocale.value))
  const markings = computed(() => props.nameplate.markings.map((marking, index) => ({
    marking,
    path: marking.path,
    name: markingName(t, marking, index, formatLocale.value),
    expired: markingExpired(marking, formatLocale.value),
  })))
</script>
