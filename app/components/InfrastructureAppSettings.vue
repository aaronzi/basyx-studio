<template>
  <div class="d-flex flex-column ga-3">
    <div class="text-body-small text-medium-emphasis">{{ t('admin.appSettings.help') }}</div>

    <v-expansion-panels v-if="installedApps.length > 0" multiple>
      <v-expansion-panel v-for="app in installedApps" :key="app.appId">
        <v-expansion-panel-title>
          <div class="d-flex flex-column">
            <span>{{ label(app.title) }}</span>
            <span class="text-body-small text-medium-emphasis">{{ app.appId }} · {{ t('admin.appSettings.count', setCount(app.appId)) }}</span>
          </div>
        </v-expansion-panel-title>

        <v-expansion-panel-text>
          <div class="d-flex flex-column ga-3">
            <AppSettingField
              v-for="setting in infrastructureSettings(app)"
              :key="setting.key"
              v-model="formOf(app.appId)[setting.key]"
              :fallback="app.settingValues[setting.key] ?? setting.default"
              level="infrastructure"
              :readonly="readonly"
              :setting="setting"
            />
          </div>
        </v-expansion-panel-text>
      </v-expansion-panel>
    </v-expansion-panels>

    <div v-else class="text-body-small text-medium-emphasis">{{ t('admin.appSettings.noApps') }}</div>

    <!-- Values the installed version no longer takes per infrastructure: a
         removed setting, or one now set per installation. Studio ignores
         them; the next save drops them (ADR 0048). -->
    <v-alert
      v-if="obsolete.length > 0"
      data-test="obsolete-settings"
      :text="t(readonly ? 'admin.appSettings.obsoleteIgnored' : 'admin.appSettings.obsoleteDropped', { list: obsolete.map(entry => `${entry.title}: ${entry.keys.join(', ')}`).join('; ') })"
      type="warning"
    />

    <!-- Values for apps that are not installed (from YAML or an import) are
         kept and checked when the app is installed. -->
    <v-list v-if="otherEntries.length > 0">
      <v-list-item
        v-for="entry in otherEntries"
        :key="entry.app"
        prepend-icon="mdi-puzzle-remove-outline"
        :subtitle="t('admin.appSettings.notInstalled', { list: Object.keys(entry.values).join(', ') })"
        :title="entry.app"
      >
        <template v-if="!readonly" #append>
          <v-btn :aria-label="t('admin.appSettings.remove')" icon="mdi-close" @click="apps = apps.filter(other => other !== entry)" />
        </template>
      </v-list-item>
    </v-list>
  </div>
</template>

<script lang="ts" setup>
  import type { AppInstallation, AppInstallationList } from '#shared/contract'
  import type { InfrastructureAppSettingsForm, SettingFormValues } from '~/utils/app-settings'
  import { useQuery } from '@pinia/colada'
  import { isSettingSet, obsoleteSettingKeys } from '~/utils/app-settings'

  // The values of the installed apps' `infrastructure` settings on this
  // infrastructure (ADR 0048). They win over the installation's values; a
  // field without a value falls back to it, then to the default.
  const props = defineProps<{ readonly?: boolean }>()
  const apps = defineModel<InfrastructureAppSettingsForm[]>({ required: true })

  const { t } = useI18n()
  const api = useStudioApi()
  const label = useLocalizedLabel()

  const installations = useQuery({
    key: ['admin', 'apps'],
    query: ({ signal }) => api<AppInstallationList>('/app-installations', { signal }),
  })

  function infrastructureSettings (app: AppInstallation) {
    return app.settings.filter(setting => setting.scope === 'infrastructure')
  }

  const installed = computed(() => installations.data.value?.items ?? [])
  const installedApps = computed(() => installed.value.filter(app => infrastructureSettings(app).length > 0))
  /** Entries of apps that are not installed; they are kept as they are. */
  const otherEntries = computed(() => apps.value.filter(entry => !installed.value.some(app => app.appId === entry.app)))

  /** What an installed app's version no longer takes per infrastructure, by app. */
  const obsolete = ref<Array<{ app: string, title: string, keys: string[] }>>([])
  /** The list this component made last, so a new one (the dialog opened again) starts afresh. */
  let reconciled: InfrastructureAppSettingsForm[] | null = null

  // Every installed app with such settings gets an entry to edit. Values its
  // version does not take are marked, and left out of the next save unless
  // the infrastructure is read-only.
  watch([installed, apps], ([list, entries]) => {
    if (installations.data.value === undefined) {
      return
    }
    // The model hands back a reactive proxy of the list this component made.
    if (toRaw(entries) !== reconciled) {
      obsolete.value = []
    }
    const next: InfrastructureAppSettingsForm[] = []
    for (const entry of entries) {
      const app = list.find(candidate => candidate.appId === entry.app)
      const keys = app ? obsoleteSettingKeys(app.settings, entry.values) : []
      if (keys.length > 0) {
        obsolete.value = [...obsolete.value.filter(other => other.app !== entry.app), { app: entry.app, title: label(app!.title), keys }]
      }
      if (props.readonly || keys.length === 0) {
        next.push(entry)
        continue
      }
      const values = Object.fromEntries(Object.entries(entry.values).filter(([key]) => !keys.includes(key)))
      if (Object.keys(values).length > 0 || infrastructureSettings(app!).length > 0) {
        next.push({ app: entry.app, values })
      }
    }
    const missing = installedApps.value.filter(app => !next.some(entry => entry.app === app.appId))
    next.push(...missing.map(app => ({ app: app.appId, values: {} })))
    if (next.length !== entries.length || next.some((entry, index) => entry !== entries[index])) {
      reconciled = next
      apps.value = next
    }
  }, { immediate: true })

  function formOf (appId: string): SettingFormValues {
    return apps.value.find(entry => entry.app === appId)?.values ?? {}
  }

  function setCount (appId: string): number {
    return Object.values(formOf(appId)).filter(value => isSettingSet(value)).length
  }
</script>
