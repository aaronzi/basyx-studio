<template>
  <v-card>
    <v-card-item prepend-icon="mdi-timeline-clock-outline">
      <v-card-title>{{ t('changes.title') }}</v-card-title>
      <v-card-subtitle>{{ t('changes.subtitle') }}</v-card-subtitle>
    </v-card-item>

    <v-divider />

    <v-card-text>
      <ProblemAlert v-if="changes.error.value" :error="changes.error.value" retry @retry="changes.refetch()" />
      <v-skeleton-loader v-else-if="changes.isLoading.value" type="list-item-two-line@4" />

      <v-timeline
        v-else-if="items.length > 0"
        align="start"
        density="compact"
        side="end"
        truncate-line="both"
      >
        <v-timeline-item
          v-for="event in items"
          :key="event.id"
          :dot-color="changeMeta[event.action].color"
          :icon="changeMeta[event.action].icon"
          size="small"
        >
          <v-list-item
            class="px-0"
            :subtitle="`${timeAgo(event.time)} · ${event.subject}`"
            :title="t(`changes.${event.entity}.${event.action}`, { name: labels[event.subject] ?? '' })"
          />
        </v-timeline-item>
      </v-timeline>

      <v-empty-state
        v-else
        icon="mdi-timeline-remove-outline"
        size="56"
        :text="t('changes.noneText')"
        :title="t('changes.none')"
      />
    </v-card-text>
  </v-card>
</template>

<script lang="ts" setup>
  import type { ChangePage, SubmodelRef } from '#shared/contract'
  import { useQuery } from '@pinia/colada'
  import { changeMeta } from '~/utils/aas'

  const props = defineProps<{ targetId: string, shellId: string, refs: SubmodelRef[] }>()

  const { t } = useI18n()
  const api = useStudioApi()
  const timeAgo = useTimeAgo()

  const subjects = computed(() => [props.shellId, ...props.refs.map(ref => ref.submodelId)])
  const labels = computed(() => Object.fromEntries(props.refs.map(ref => [ref.submodelId, ref.idShort ?? ref.submodelId])))

  const changes = useQuery({
    key: () => ['targets', props.targetId, 'changes', ...subjects.value],
    query: ({ signal }) => api<ChangePage>(`/targets/${props.targetId}/changes`, { query: { subjects: subjects.value, limit: 50 }, signal }),
    refetchOnWindowFocus: true,
  })
  const items = computed(() => changes.data.value?.items ?? [])
</script>
