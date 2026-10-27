<template>
  <div v-if="description || keywords.length > 0 || facts.length > 0" class="d-flex flex-column ga-4" data-test="document-summary">
    <div v-if="description" class="text-body-medium text-pre-wrap">{{ description }}</div>

    <div v-if="keywords.length > 0" class="d-flex flex-wrap align-center ga-1">
      <v-icon class="me-1 text-medium-emphasis" icon="mdi-tag-multiple-outline" size="16" />

      <v-chip v-for="keyword in keywords" :key="keyword" size="x-small" :text="keyword" />
    </div>

    <DefinitionList v-if="facts.length > 0" :rows="facts" />
  </div>
</template>

<script lang="ts" setup>
  import type { DocumentVersion } from './handoverDocumentation'
  import { computed } from 'vue'
  import DefinitionList from './DefinitionList.vue'
  import { pickText } from './handoverDocumentation'
  import { useI18n } from './i18n'
  import { versionFacts } from './presentation'

  // Below the file: the version's summary, its keywords and the key facts.
  const props = defineProps<{ version: DocumentVersion | undefined }>()

  const { t, formatLocale } = useI18n()

  const description = computed(() => pickText(props.version?.description ?? [], formatLocale.value))
  /** Keywords come as one text, separated by commas or semicolons. */
  const keywords = computed(() => [...new Set(pickText(props.version?.keywords ?? [], formatLocale.value).split(/[,;]/).map(word => word.trim()).filter(Boolean))])
  const facts = computed(() => versionFacts(t, props.version, formatLocale.value))
</script>
