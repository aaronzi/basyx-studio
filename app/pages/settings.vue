<template>
  <v-container max-width="960">
    <h1 class="text-headline-medium font-weight-semibold">{{ t('settings.title') }}</h1>
    <p class="text-body-large text-medium-emphasis mb-4">{{ t('settings.subtitle') }}</p>

    <v-row>
      <v-col cols="12" md="6">
        <v-card height="100%">
          <v-card-item prepend-icon="mdi-palette-outline">
            <v-card-title>{{ t('settings.appearance') }}</v-card-title>
          </v-card-item>

          <v-card-text>
            <div class="text-label-large mb-2">{{ t('settings.theme') }}</div>

            <v-btn-toggle
              class="d-flex mb-6"
              divided
              mandatory
              :model-value="preferences.theme"
              variant="outlined"
              @update:model-value="value => save({ theme: value })"
            >
              <v-btn class="flex-grow-1" prepend-icon="mdi-weather-sunny" :text="t('settings.light')" value="light" />
              <v-btn class="flex-grow-1" prepend-icon="mdi-weather-night" :text="t('settings.dark')" value="dark" />
              <v-btn class="flex-grow-1" prepend-icon="mdi-monitor" :text="t('settings.system')" value="system" />
            </v-btn-toggle>

            <v-select
              :items="languages"
              :label="t('settings.valueLanguage')"
              :model-value="preferences.valueLanguage"
              prepend-inner-icon="mdi-translate"
              @update:model-value="value => save({ valueLanguage: value })"
            />
          </v-card-text>
        </v-card>
      </v-col>

      <v-col cols="12" md="6">
        <v-card height="100%">
          <v-card-item prepend-icon="mdi-refresh-auto">
            <v-card-title>{{ t('settings.refresh') }}</v-card-title>
            <v-card-subtitle>{{ t('settings.refreshSubtitle') }}</v-card-subtitle>
          </v-card-item>

          <v-list>
            <v-list-item :subtitle="t('settings.refreshHint')" :title="t('settings.refreshOpen')">
              <template #append>
                <v-switch color="success" :model-value="preferences.autoRefresh" @update:model-value="value => save({ autoRefresh: Boolean(value) })" />
              </template>
            </v-list-item>
          </v-list>

          <v-card-text>
            <v-slider
              color="primary"
              :disabled="!preferences.autoRefresh"
              hide-details
              :label="t('settings.interval')"
              :max="60"
              :min="1"
              :model-value="preferences.refreshIntervalSeconds"
              :step="1"
              thumb-label
              @end="value => save({ refreshIntervalSeconds: Number(value) })"
            >
              <template #append>
                <v-chip :text="t('settings.seconds', { count: preferences.refreshIntervalSeconds })" />
              </template>
            </v-slider>
          </v-card-text>
        </v-card>
      </v-col>

      <v-col v-if="session.isAdmin" cols="12">
        <v-card :subtitle="t('settings.infrastructuresSubtitle')" :title="t('app.infrastructures')" to="/admin/infrastructures">
          <template #prepend>
            <v-icon icon="mdi-server-network" />
          </template>

          <template #append>
            <v-icon icon="mdi-chevron-right" />
          </template>
        </v-card>
      </v-col>
    </v-row>
  </v-container>
</template>

<script lang="ts" setup>
  import type { Preferences } from '#shared/contract'

  const { t } = useI18n()
  const session = useSessionStore()
  const store = usePreferences()
  const preferences = computed(() => store.preferences.value)

  const languages = [
    { title: 'English', value: 'en' },
    { title: 'Deutsch', value: 'de' },
    { title: 'Français', value: 'fr' },
    { title: 'Español', value: 'es' },
    { title: 'Italiano', value: 'it' },
  ]

  function save (change: Partial<Preferences>) {
    return store.update(current => ({ ...current, ...change }))
  }
</script>
