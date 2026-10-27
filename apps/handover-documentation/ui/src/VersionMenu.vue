<template>
  <v-menu v-if="versions.length > 1">
    <template #activator="{ props: activator }">
      <!-- A chip like the single version's, so both are the same height. -->
      <v-chip
        v-bind="activator"
        append-icon="mdi-chevron-down"
        data-test="version-menu"
        link
        prepend-icon="mdi-source-branch"
        :text="label(selected)"
      />
    </template>

    <v-list min-width="240">
      <v-list-item
        v-for="version in sorted"
        :key="version.key"
        :active="version.key === selected?.key"
        :subtitle="version.setDate ? dateText(version.setDate, formatLocale) : undefined"
        :title="label(version)"
        @click="emit('select', version.key)"
      >
        <template #append>
          <v-chip
            v-if="version.key === latestKey"
            class="me-1"
            color="primary"
            size="x-small"
            :text="t('version.latest')"
          />

          <v-chip
            v-if="version.status"
            :color="statusColor(version.status)"
            size="x-small"
            :text="statusText(t, version.status)"
          />
        </template>
      </v-list-item>
    </v-list>
  </v-menu>

  <v-chip
    v-else-if="selected && (selected.version || selected.setDate)"
    data-test="version-menu"
    prepend-icon="mdi-source-branch"
    :text="label(selected)"
  />
</template>

<script lang="ts" setup>
  import type { DocumentVersion } from './handoverDocumentation'
  import { computed } from 'vue'
  import { latestVersion, sortVersions } from './handoverDocumentation'
  import { useI18n } from './i18n'
  import { dateText, statusColor, statusText, versionLabel } from './presentation'

  // The document's versions, newest first; one version is a plain chip.
  const props = defineProps<{
    versions: DocumentVersion[]
    selected: DocumentVersion | undefined
  }>()
  const emit = defineEmits<{ select: [key: string] }>()

  const { t, formatLocale } = useI18n()

  const latestKey = computed(() => latestVersion(props.versions)?.key)
  const sorted = computed(() => sortVersions(props.versions))

  function label (version: DocumentVersion | undefined): string {
    return version ? versionLabel(t, version, props.versions.indexOf(version)) : ''
  }
</script>
