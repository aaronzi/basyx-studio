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

    <v-progress-linear v-if="list.isLoading.value" />

    <v-card v-else>
      <v-list v-if="list.data.value?.items.length" lines="two">
        <v-list-item
          v-for="item in list.data.value.items"
          :key="item.id"
          :prepend-icon="securityModeIcons[item.security.mode]"
          :subtitle="`${t(`security.${item.security.mode}`)} · ${item.endpoints.map(endpoint => endpoint.url).filter((url, index, all) => all.indexOf(url) === index).join(', ')}`"
          :title="item.name"
        >
          <template v-if="probes[item.id]" #default>
            <div class="mt-1">
              <v-chip
                v-for="endpoint in probes[item.id]!.endpoints"
                :key="endpoint.type"
                class="mr-1"
                :color="endpoint.reachable ? 'success' : 'error'"
                size="x-small"
                :text="`${endpoint.type}: ${endpoint.reachable ? `${endpoint.status} · ${endpoint.latencyMs} ms` : endpoint.error}`"
              />
            </div>
          </template>

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
  import { useQuery, useQueryCache } from '@pinia/colada'
  import { securityModeIcons } from '~/utils/aas'

  const { t } = useI18n()
  const api = useStudioApi()
  const queryCache = useQueryCache()

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
    await Promise.all([
      queryCache.invalidateQueries({ key: ['admin', 'infrastructures'] }),
      queryCache.invalidateQueries({ key: ['targets'] }),
    ])
  }

  async function probe (item: Infrastructure) {
    probing.value = item.id
    actionError.value = null
    try {
      probes.value = { ...probes.value, [item.id]: await api<ProbeResult>(`/infrastructures/${item.id}/probe`, { method: 'POST' }) }
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
