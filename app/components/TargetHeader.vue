<template>
  <div class="d-flex flex-wrap align-center ga-4 mb-4">
    <v-breadcrumbs class="pa-0" :items="crumbs" />
    <v-spacer />
    <TargetChips v-if="target" :target="target" />

    <v-btn
      v-if="target?.authenticationState === 'authenticated'"
      prepend-icon="mdi-account-cancel-outline"
      size="small"
      :text="t('target.revoke')"
      variant="text"
      @click="revoke"
    />
  </div>
</template>

<script lang="ts" setup>
  import type { Target } from '#shared/contract'
  import { useQueryCache } from '@pinia/colada'

  const props = defineProps<{
    target: Target | undefined
    trail?: Array<{ title: string, to?: string }>
  }>()

  const { t } = useI18n()
  const api = useStudioApi()
  const queryCache = useQueryCache()

  const crumbs = computed(() => [
    { title: t('home.title'), to: '/' },
    ...(props.target ? [{ title: props.target.name, to: `/targets/${props.target.id}`, exact: true }] : []),
    ...(props.trail ?? []),
  ])

  async function revoke () {
    if (!props.target) {
      return
    }
    await api(`/targets/${props.target.id}/authorization`, { method: 'DELETE' })
    // Drop everything cached for this target, then reload its state.
    await queryCache.invalidateQueries({ key: ['targets', props.target.id] })
  }
</script>
