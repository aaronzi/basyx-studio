<template>
  <v-container fluid max-width="none">
    <TargetHeader :target="target.data.value" :trail="trail" />

    <ProblemAlert v-if="target.error.value" :error="target.error.value" retry @retry="target.refetch()" />

    <TargetAuthorization
      v-else-if="target.data.value && (target.needsAuthorization.value || authRequired)"
      :target="target.data.value"
      @authorized="onAuthorized"
    />

    <ProblemAlert v-else-if="shell.error.value" :error="shell.error.value" retry @retry="shell.refetch()" />

    <v-row v-else-if="target.data.value" density="compact">
      <v-col cols="12" lg="3" md="4">
        <v-card-pane>
          <v-card-title class="text-title-medium">{{ t('shell.submodels') }}</v-card-title>
          <v-divider />

          <div class="flex-grow-1 overflow-auto">
            <v-progress-linear v-if="refs.isLoading.value" />

            <ProblemAlert
              v-else-if="refs.error.value"
              class="ma-2"
              :error="refs.error.value"
              retry
              @retry="refs.refetch()"
            />

            <div v-else-if="refs.data.value?.items.length === 0" class="pa-4 text-medium-emphasis">{{ t('shell.noSubmodels') }}</div>

            <v-list v-else density="compact" nav>
              <v-list-item
                v-for="ref in refs.data.value?.items"
                :key="ref.key"
                :active="ref.key === submodelKey"
                :disabled="ref.status !== 'available'"
                :prepend-icon="ref.status === 'available' ? 'mdi-file-tree-outline' : (ref.status === 'forbidden' ? 'mdi-lock-outline' : 'mdi-alert-circle-outline')"
                :subtitle="ref.status === 'available' ? (ref.semanticId ?? ref.submodelId) : t(`shell.refStatus.${ref.status}`)"
                :title="ref.idShort ?? ref.submodelId"
                @click="selectSubmodel(ref.key)"
              />
            </v-list>
          </div>
        </v-card-pane>
      </v-col>

      <v-col cols="12" lg="4" md="8">
        <v-card-pane>
          <v-card-title class="text-title-medium">{{ t('shell.elements') }}</v-card-title>
          <v-divider />

          <div class="flex-grow-1 overflow-auto">
            <ElementTree
              v-if="submodelKey"
              :key="`${targetId}:${submodelKey}`"
              v-model:selected="elementKey"
              :submodel-key="submodelKey"
              :target-id="targetId"
            />

            <div v-else class="pa-4 text-medium-emphasis">{{ t('shell.selectSubmodel') }}</div>
          </div>
        </v-card-pane>
      </v-col>

      <v-col cols="12" lg="5">
        <v-card-pane>
          <v-card-title class="text-title-medium">{{ t('shell.details') }}</v-card-title>
          <v-divider />

          <div class="flex-grow-1 overflow-auto">
            <v-progress-linear v-if="details.isLoading.value" />
            <ProblemAlert v-else-if="details.error.value" class="ma-2" :error="details.error.value" />
            <JsonPanel v-else-if="details.data.value" :label="details.data.value.label" :value="details.data.value.value" />
          </div>
        </v-card-pane>
      </v-col>
    </v-row>
  </v-container>
</template>

<script lang="ts" setup>
  import type { ElementDetail, ShellDetail, SubmodelDetail, SubmodelRef } from '#shared/contract'
  import { useQuery, useQueryCache } from '@pinia/colada'
  import { StudioApiError } from '~/composables/useStudioApi'

  const { t } = useI18n()
  const route = useRoute()
  const router = useRouter()
  const api = useStudioApi()
  const queryCache = useQueryCache()

  const targetId = computed(() => String(route.params.targetId))
  const shellKey = computed(() => String(route.params.shellKey))
  const submodelKey = computed(() => typeof route.query.submodel === 'string' ? route.query.submodel : null)
  const elementKey = computed({
    get: () => typeof route.query.element === 'string' ? route.query.element : null,
    set: (key: string | null) => router.replace({ query: { ...route.query, element: key ?? undefined } }),
  })

  const target = useTarget(targetId)
  const ready = () => target.data.value !== undefined && !target.needsAuthorization.value

  const shell = useQuery({
    key: () => ['targets', targetId.value, 'shells', shellKey.value],
    query: ({ signal }) => api<ShellDetail>(`/targets/${targetId.value}/shells/${shellKey.value}`, { signal }),
    enabled: ready,
  })

  const refs = useQuery({
    key: () => ['targets', targetId.value, 'shells', shellKey.value, 'submodel-refs'],
    query: ({ signal }) => api<{ items: SubmodelRef[] }>(`/targets/${targetId.value}/shells/${shellKey.value}/submodel-refs`, { signal }),
    enabled: ready,
  })

  // The JSON pane shows the selected element, else the submodel, else the shell.
  const details = useQuery({
    key: () => ['targets', targetId.value, 'details', shellKey.value, submodelKey.value ?? '', elementKey.value ?? ''],
    query: async ({ signal }) => {
      if (submodelKey.value && elementKey.value) {
        const detail = await api<ElementDetail>(`/targets/${targetId.value}/submodels/${submodelKey.value}/elements/${elementKey.value}`, { signal })
        return { label: detail.path, value: detail.value }
      }
      if (submodelKey.value) {
        const detail = await api<SubmodelDetail>(`/targets/${targetId.value}/submodels/${submodelKey.value}`, { signal })
        return { label: String(detail.submodel.idShort ?? detail.submodel.id), value: detail.submodel }
      }
      const detail = await api<ShellDetail>(`/targets/${targetId.value}/shells/${shellKey.value}`, { signal })
      return { label: String(detail.shell.idShort ?? detail.shell.id), value: detail.shell }
    },
    enabled: ready,
  })

  const authRequired = computed(() => [shell.error.value, refs.error.value]
    .some(error => error instanceof StudioApiError && error.code === 'target_auth_required'))

  const trail = computed(() => {
    const value = shell.data.value?.shell
    return value ? [{ title: String(value.idShort ?? value.id) }] : []
  })

  function selectSubmodel (key: string) {
    router.replace({ query: { submodel: key } })
  }

  async function onAuthorized () {
    await queryCache.invalidateQueries({ key: ['targets', targetId.value] })
  }
</script>
