<template>
  <div class="d-flex flex-column ga-4">
    <v-alert v-if="error" :text="error" type="error" />

    <v-progress-linear v-if="loading" />

    <v-row v-else-if="counts" data-test="counts">
      <v-col v-for="item in tiles" :key="item.key" cols="12" sm="4">
        <v-card :prepend-icon="item.icon" :subtitle="t(`overview.counts.${item.key}`)" :title="number.format(counts[item.key])" />
      </v-col>
    </v-row>

    <div v-if="loadedAt" class="text-body-small text-medium-emphasis" data-test="loaded-at">
      {{ t('overview.loadedAt', { date: dateTime.format(loadedAt) }) }}
    </div>
  </div>
</template>

<script lang="ts" setup>
  import type { ShellCounts } from '../inventory'
  import { computed, ref, watch } from 'vue'
  import { useClient } from '../client'
  import { useI18n } from '../i18n'
  import { countShells, loadShells } from '../inventory'

  const { client, context } = useClient()
  const { t, formatLocale } = useI18n()

  // Numbers and dates in the language of the texts, not Studio's dialect.
  const number = computed(() => new Intl.NumberFormat(formatLocale.value))
  const dateTime = computed(() => new Intl.DateTimeFormat(formatLocale.value, { dateStyle: 'long', timeStyle: 'short' }))

  const tiles = [
    { key: 'shells', icon: 'mdi-cube-outline' },
    { key: 'instances', icon: 'mdi-package-variant-closed' },
    { key: 'types', icon: 'mdi-shape-outline' },
  ] as const

  const counts = ref<ShellCounts | null>(null)
  const loadedAt = ref<Date | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)

  watch(() => context.value.target?.id, async () => {
    loading.value = true
    error.value = null
    try {
      counts.value = countShells((await loadShells(client)).shells)
      loadedAt.value = new Date()
    } catch (error_) {
      error.value = error_ instanceof Error ? error_.message : String(error_)
    } finally {
      loading.value = false
    }
  }, { immediate: true })
</script>
