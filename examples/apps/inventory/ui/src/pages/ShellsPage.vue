<template>
  <div class="d-flex flex-column ga-4">
    <v-text-field v-model="search" clearable :label="t('shells.search')" prepend-inner-icon="mdi-magnify" />

    <v-alert v-if="error" :text="error" type="error" />

    <v-progress-linear v-if="loading" />

    <v-card v-else>
      <v-list data-test="shells">
        <v-list-item v-if="shown.length === 0" :title="t('shells.none')" />

        <v-list-item
          v-for="shell in shown"
          :key="shell.id"
          prepend-icon="mdi-cube-outline"
          :subtitle="shell.id"
          :title="titleOf(shell)"
          :to="{ name: 'shell', params: { shell: shellKey(shell.id) } }"
        />
      </v-list>
    </v-card>

    <div v-if="!complete" class="text-body-small text-medium-emphasis">{{ t('shells.more', { count: number.format(shellLimit) }) }}</div>
  </div>
</template>

<script lang="ts" setup>
  import type { ShellSummary } from '@basyx/studio-sdk'
  import { langText } from '@basyx/studio-app-kit'
  import { computed, ref, watch } from 'vue'
  import { useClient } from '../client'
  import { useI18n } from '../i18n'
  import { loadShells, shellKey, shellLimit } from '../inventory'

  const { client, context } = useClient()
  const { t, formatLocale } = useI18n()
  const number = computed(() => new Intl.NumberFormat(formatLocale.value))

  const shells = ref<ShellSummary[]>([])
  const complete = ref(true)
  const search = ref<string | null>('')
  const loading = ref(false)
  const error = ref<string | null>(null)

  const titleOf = (shell: ShellSummary) => langText(shell.displayName, context.value.locale) || shell.idShort || shell.id
  const shown = computed(() => {
    const query = (search.value ?? '').trim().toLowerCase()
    return query ? shells.value.filter(shell => `${titleOf(shell)} ${shell.id}`.toLowerCase().includes(query)) : shells.value
  })

  watch(() => context.value.target?.id, async () => {
    loading.value = true
    error.value = null
    try {
      ({ shells: shells.value, complete: complete.value } = await loadShells(client))
    } catch (error_) {
      error.value = error_ instanceof Error ? error_.message : String(error_)
    } finally {
      loading.value = false
    }
  }, { immediate: true })
</script>
