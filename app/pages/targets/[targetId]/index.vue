<template>
  <v-container class="py-6" max-width="1100">
    <TargetHeader :target="target.data.value" />

    <ProblemAlert v-if="target.error.value" :error="target.error.value" retry @retry="target.refetch()" />

    <TargetAuthorization
      v-else-if="target.data.value && (target.needsAuthorization.value || authRequired)"
      :target="target.data.value"
      @authorized="onAuthorized"
    />

    <template v-else-if="target.data.value">
      <h1 class="text-headline-small mb-4">{{ t('target.shells') }}</h1>

      <ProblemAlert
        v-if="shells.error.value"
        class="mb-4"
        :error="shells.error.value"
        retry
        @retry="shells.refetch()"
      />

      <v-progress-linear v-if="shells.isLoading.value" indeterminate />

      <v-card v-else-if="items.length > 0" variant="outlined">
        <v-list lines="two">
          <v-list-item
            v-for="shell in items"
            :key="shell.key"
            prepend-icon="mdi-shield-outline"
            :subtitle="shell.id"
            :to="`/targets/${targetId}/shells/${shell.key}`"
          >
            <template #title>
              {{ langText(shell.displayName) ?? shell.idShort ?? shell.id }}
            </template>

            <template v-if="shell.assetKind" #append>
              <v-chip label size="x-small" :text="shell.assetKind" variant="tonal" />
            </template>
          </v-list-item>
        </v-list>

        <v-card-actions v-if="shells.hasNextPage.value" class="justify-center">
          <v-btn
            :loading="shells.isLoading.value"
            prepend-icon="mdi-chevron-down"
            :text="t('target.loadMore')"
            variant="text"
            @click="shells.loadNextPage()"
          />
        </v-card-actions>
      </v-card>

      <v-empty-state v-else-if="shells.data.value" icon="mdi-shield-off-outline" :title="t('target.noShells')" />
    </template>
  </v-container>
</template>

<script lang="ts" setup>
  import type { Page, ShellSummary } from '#shared/contract'
  import { useInfiniteQuery, useQueryCache } from '@pinia/colada'
  import { StudioApiError } from '~/composables/useStudioApi'
  import { langText } from '~/utils/aas'

  const { t } = useI18n()
  const route = useRoute()
  const api = useStudioApi()
  const queryCache = useQueryCache()

  const targetId = computed(() => String(route.params.targetId))
  const target = useTarget(targetId)

  const shells = useInfiniteQuery({
    key: () => ['targets', targetId.value, 'shells'],
    query: ({ pageParam, signal }) => api<Page<ShellSummary>>(`/targets/${targetId.value}/shells`, {
      query: { limit: 25, cursor: pageParam ?? undefined },
      signal,
    }),
    initialPageParam: null as string | null,
    getNextPageParam: lastPage => lastPage.page.nextCursor,
    enabled: () => target.data.value !== undefined && !target.needsAuthorization.value,
  })

  const items = computed(() => shells.data.value?.pages.flatMap(page => page.items) ?? [])
  const authRequired = computed(() => shells.error.value instanceof StudioApiError && shells.error.value.code === 'target_auth_required')

  async function onAuthorized () {
    await queryCache.invalidateQueries({ key: ['targets', targetId.value] })
  }
</script>
