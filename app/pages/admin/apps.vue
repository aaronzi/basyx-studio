<template>
  <v-container>
    <PageHeader :subtitle="t('apps.subtitle')" :title="t('apps.title')" />

    <ProblemAlert
      v-if="list.error.value"
      class="mb-4"
      :error="list.error.value"
      retry
      @retry="list.refetch()"
    />

    <v-progress-linear v-if="list.isPending.value" />

    <template v-else-if="list.data.value">
      <v-alert v-if="!list.data.value.enabled" class="mb-4" :text="t('apps.disabled')" type="info" />

      <v-alert v-else-if="!list.data.value.allowUnsigned" class="mb-4" :text="t('apps.unsignedDisabled')" type="info" />

      <v-card v-else class="mb-4" :title="t('apps.install')">
        <v-card-text>
          <p class="text-body-medium text-medium-emphasis mt-0 mb-4">{{ t('apps.installHint') }}</p>

          <div class="d-flex flex-wrap align-center ga-4">
            <v-file-input
              v-model="file"
              accept=".zip,application/zip"
              class="flex-grow-1"
              hide-details
              :label="t('apps.package')"
              prepend-icon="mdi-folder-zip-outline"
            />

            <v-btn-primary
              :disabled="!file"
              :loading="installing"
              prepend-icon="mdi-download"
              :text="t('apps.install')"
              @click="install"
            />
          </div>

          <v-alert
            v-if="installed"
            class="mt-4"
            closable
            :text="installed"
            type="success"
            @click:close="installed = null"
          />

          <template v-if="installError">
            <ProblemAlert class="mt-4" :error="installError" />

            <v-list v-if="findings.length > 0">
              <v-list-subheader>{{ t('apps.findings') }}</v-list-subheader>

              <v-list-item
                v-for="finding in findings"
                :key="`${finding.path}:${finding.message}`"
                prepend-icon="mdi-alert-circle-outline"
                :subtitle="finding.message"
                :title="finding.path"
              />
            </v-list>
          </template>
        </v-card-text>
      </v-card>

      <ProblemAlert v-if="actionError" class="mb-4" :error="actionError" />

      <v-card>
        <template v-if="items.length > 0">
          <ListFilterBar
            v-model:search="search"
            v-model:selected="selected"
            :options="filterOptions"
            :placeholder="t('apps.search')"
          />

          <v-divider />
        </template>

        <v-list-records v-if="filtered.length > 0">
          <template v-for="(item, index) in filtered" :key="item.id">
            <v-divider v-if="index > 0" />

            <RecordListItem prepend-icon="mdi-puzzle-outline" :title="label(item.title)">
              <v-list-item-subtitle>
                {{ t('apps.by', { publisher: item.publisher }) }} · {{ item.appId }} ·
                {{ t('apps.submodelViews', item.submodelViews) }} · {{ t('apps.modules', item.modules) }}
              </v-list-item-subtitle>

              <div class="d-flex flex-wrap ga-1 mt-2">
                <v-chip v-if="item.unsigned" color="warning" prepend-icon="mdi-alert-outline">
                  {{ t('apps.unsigned') }}
                  <v-tooltip activator="parent" :text="t('apps.unsignedHint')" />
                </v-chip>

                <v-chip v-if="item.bundled" color="primary" prepend-icon="mdi-check-decagram-outline">
                  {{ t('apps.bundled') }}
                  <v-tooltip activator="parent" :text="t('apps.bundledHint')" />
                </v-chip>

                <v-chip v-if="item.backend" prepend-icon="mdi-server" :text="t('apps.backend')" />

                <v-chip
                  v-for="permission in item.permissions"
                  :key="permission"
                  :text="t(`apps.permission.${permission.replaceAll('.', '_')}`)"
                />
              </div>

              <template #meta>
                <span class="text-body-small text-medium-emphasis text-no-wrap">{{ item.version }}</span>
              </template>

              <template v-if="!item.bundled" #actions>
                <v-btn
                  v-tooltip="t('apps.uninstall')"
                  :aria-label="t('apps.uninstall')"
                  icon="mdi-delete-outline"
                  @click="confirmUninstall = item"
                />
              </template>
            </RecordListItem>
          </template>
        </v-list-records>

        <v-card-text v-else-if="items.length > 0" class="text-medium-emphasis">{{ t('lists.noMatches') }}</v-card-text>

        <v-card-text v-else class="text-medium-emphasis">{{ t('apps.noApps') }}</v-card-text>
      </v-card>
    </template>

    <v-dialog max-width="480" :model-value="confirmUninstall !== null" @update:model-value="confirmUninstall = null">
      <v-card :title="t('apps.uninstall')">
        <v-card-text>{{ t('apps.uninstallConfirm', { name: confirmUninstall ? label(confirmUninstall.title) : '' }) }}</v-card-text>

        <v-card-actions>
          <v-spacer />
          <v-btn :text="t('apps.cancel')" @click="confirmUninstall = null" />
          <v-btn-primary color="error" :text="t('apps.uninstall')" @click="uninstall" />
        </v-card-actions>
      </v-card>
    </v-dialog>
  </v-container>
</template>

<script lang="ts" setup>
  import type { AppInstallation } from '#shared/contract'
  import type { FilterOption } from '~/utils/records'
  import { useQuery } from '@pinia/colada'
  import { StudioApiError } from '~/composables/useStudioApi'
  import { filterRecords } from '~/utils/records'

  const { t } = useI18n()
  const api = useStudioApi()
  const invalidate = useInvalidate()
  const label = useLocalizedLabel()

  const list = useQuery({
    key: ['admin', 'apps'],
    query: ({ signal }) => api<{ items: AppInstallation[], enabled: boolean, allowUnsigned: boolean }>('/app-installations', { signal }),
  })

  const items = computed(() => list.data.value?.items ?? [])
  const search = ref<string | null>(null)
  const selected = ref<string[]>([])

  const filterOptions = computed<FilterOption[]>(() => [
    { value: 'source:bundled', title: t('apps.bundled'), icon: 'mdi-check-decagram-outline' },
    { value: 'source:uploaded', title: t('apps.uploaded'), icon: 'mdi-upload-outline' },
    { value: 'trust:unsigned', title: t('apps.unsigned'), icon: 'mdi-alert-outline' },
    { value: 'backend:yes', title: t('apps.backend'), icon: 'mdi-server' },
  ].filter(option => items.value.some(item => facetsOf(item).includes(option.value))))

  function facetsOf (item: AppInstallation): string[] {
    return [item.bundled ? 'source:bundled' : 'source:uploaded', ...(item.unsigned ? ['trust:unsigned'] : []), ...(item.backend ? ['backend:yes'] : [])]
  }

  const filtered = computed(() => filterRecords(items.value, search.value, selected.value, item => ({
    text: [label(item.title), item.publisher, item.appId],
    facets: facetsOf(item),
  })))

  const file = ref<File | null>(null)
  const installing = ref(false)
  const installed = ref<string | null>(null)
  const installError = ref<unknown>(null)
  const actionError = ref<unknown>(null)
  const confirmUninstall = ref<AppInstallation | null>(null)

  const findings = computed(() => installError.value instanceof StudioApiError ? (installError.value.problem?.violations ?? []) : [])

  async function refresh () {
    // Open views and modules of every page depend on the installed apps.
    await invalidate(['admin', 'apps'], ['app-contributions'])
  }

  async function install () {
    if (!file.value) {
      return
    }
    installing.value = true
    installed.value = null
    installError.value = null
    try {
      const installation = await api<AppInstallation>('/app-installations', {
        method: 'POST',
        body: file.value,
        headers: { 'Content-Type': 'application/zip' },
      })
      installed.value = t('apps.installed', { name: label(installation.title), version: installation.version })
      file.value = null
      await refresh()
    } catch (error) {
      installError.value = error
    } finally {
      installing.value = false
    }
  }

  async function uninstall () {
    const item = confirmUninstall.value
    confirmUninstall.value = null
    if (!item) {
      return
    }
    actionError.value = null
    try {
      await api(`/app-installations/${item.id}`, { method: 'DELETE' })
      await refresh()
    } catch (error) {
      actionError.value = error
    }
  }
</script>
