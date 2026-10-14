<template>
  <v-container>
    <div class="d-flex flex-wrap align-center ga-4 mb-6">
      <div>
        <h1 class="text-headline-medium">{{ t('admin.title') }}</h1>
        <p class="text-body-large text-medium-emphasis">{{ t('admin.subtitle') }}</p>
      </div>

      <v-spacer />

      <v-btn-primary prepend-icon="mdi-plus" :text="t('admin.add')" @click="edit(null)" />
    </div>

    <ProblemAlert
      v-if="list.error.value"
      class="mb-4"
      :error="list.error.value"
      retry
      @retry="list.refetch()"
    />

    <ProblemAlert v-if="actionError" class="mb-4" :error="actionError" />

    <v-progress-linear v-if="list.isPending.value" />

    <v-card v-else>
      <v-list v-if="list.data.value?.items.length" lines="two">
        <v-list-item
          v-for="item in list.data.value.items"
          :key="item.id"
          :prepend-icon="securityModeIcons[item.security.mode]"
          :subtitle="`${t(`admin.templates.${item.template}.title`)} · ${t(`security.${item.security.mode}`)} · ${item.endpoints.map(endpoint => endpoint.url).filter((url, index, all) => all.indexOf(url) === index).join(', ')}`"
          :title="item.name"
        >
          <div class="d-flex flex-wrap ga-1 mt-1">
            <v-chip v-if="serviceUrl(item, 'aasRegistry') && serviceUrl(item, 'aasRepository')" prepend-icon="mdi-format-list-bulleted" :text="t(`admin.listSources.${item.listSource}`)" />

            <v-chip
              v-for="feature in announcedFeatures(item)"
              :key="feature"
              color="primary"
              :text="t(`admin.announced.${feature}`)"
            />

            <v-chip v-if="item.probedAt" prepend-icon="mdi-clock-outline" :text="t('admin.probedAt', { time: new Date(item.probedAt).toLocaleString(locale) })" variant="text" />
          </div>

          <div v-if="probes[item.id]" class="d-flex flex-wrap ga-1 mt-1">
            <v-chip
              v-for="endpoint in probes[item.id]!.endpoints"
              :key="endpoint.type"
              :color="endpoint.reachable ? 'success' : 'error'"
              :text="`${t(`admin.endpointTypes.${endpoint.type}`)}: ${endpoint.reachable ? `${endpoint.status} · ${endpoint.latencyMs} ms` : endpoint.error}`"
            />
          </div>

          <template #append>
            <v-btn
              :aria-label="t('admin.probe')"
              icon="mdi-lan-connect"
              :loading="probing === item.id"
              @click="probe(item)"
            />

            <v-btn
              :aria-label="t('admin.edit')"
              icon="mdi-pencil-outline"
              @click="edit(item)"
            />

            <v-btn
              :aria-label="t('admin.delete')"
              icon="mdi-delete-outline"
              @click="confirmDelete = item"
            />
          </template>
        </v-list-item>
      </v-list>

      <v-card-text v-else class="text-medium-emphasis">{{ t('admin.noInfrastructures') }}</v-card-text>
    </v-card>

    <InfrastructureDialog v-model="dialogOpen" :existing="editing" @saved="refresh" />

    <v-dialog max-width="480" :model-value="confirmDelete !== null" @update:model-value="confirmDelete = null">
      <v-card :title="t('admin.delete')">
        <v-card-text>{{ t('admin.deleteConfirm', { name: confirmDelete?.name ?? '' }) }}</v-card-text>

        <v-card-actions>
          <v-spacer />
          <v-btn :text="t('admin.cancel')" @click="confirmDelete = null" />
          <v-btn-primary color="error" :text="t('admin.delete')" @click="remove" />
        </v-card-actions>
      </v-card>
    </v-dialog>
  </v-container>
</template>

<script lang="ts" setup>
  import type { Infrastructure, ProbeResult } from '#shared/contract'
  import { useQuery } from '@pinia/colada'
  import { serviceUrl } from '#shared/contract'
  import { securityModeIcons } from '~/utils/aas'

  const { t, locale } = useI18n()
  const api = useStudioApi()
  const invalidate = useInvalidate()

  /** The features an infrastructure's services announce, for the row chips. */
  function announcedFeatures (item: Infrastructure): Array<keyof Infrastructure['announced']> {
    return (Object.keys(item.announced) as Array<keyof Infrastructure['announced']>).filter(feature => item.announced[feature])
  }

  const list = useQuery({
    key: ['admin', 'infrastructures'],
    query: ({ signal }) => api<{ items: Infrastructure[] }>('/infrastructures', { signal }),
  })

  const dialogOpen = ref(false)
  const editing = ref<Infrastructure | null>(null)
  const confirmDelete = ref<Infrastructure | null>(null)
  const probing = ref<string | null>(null)
  const probes = ref<Record<string, ProbeResult>>({})
  const actionError = ref<unknown>(null)

  function edit (item: Infrastructure | null) {
    editing.value = item
    dialogOpen.value = true
  }

  async function refresh () {
    // Target lists and per-target data depend on the infrastructure configuration.
    await invalidate(['admin', 'infrastructures'], ['targets'])
  }

  async function probe (item: Infrastructure) {
    probing.value = item.id
    actionError.value = null
    try {
      probes.value = { ...probes.value, [item.id]: await api<ProbeResult>(`/infrastructures/${item.id}/probe`, { method: 'POST' }) }
      // The probe stored the profiles the services announce now.
      await refresh()
    } catch (error) {
      actionError.value = error
    } finally {
      probing.value = null
    }
  }

  async function remove () {
    const item = confirmDelete.value
    confirmDelete.value = null
    if (!item) {
      return
    }
    actionError.value = null
    try {
      await api(`/infrastructures/${item.id}`, { method: 'DELETE' })
      await refresh()
    } catch (error) {
      actionError.value = error
    }
  }
</script>
