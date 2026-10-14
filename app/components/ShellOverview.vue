<template>
  <v-row>
    <v-col v-for="view in views" :key="`${view.submodel.key}:${view.contribution.installationId}:${view.contribution.id}`" cols="12" lg="6">
      <AppFrame
        :contribution="view.contribution"
        fit
        :shell-id="shellId"
        :submodel="{ id: view.submodel.submodelId, semanticId: view.submodel.semanticId }"
        :target="target"
      />
    </v-col>

    <v-col v-if="contributions.isLoading.value" cols="12">
      <v-skeleton-loader type="card" />
    </v-col>

    <v-col v-else-if="views.length === 0" cols="12">
      <v-empty-state
        icon="mdi-puzzle-outline"
        size="64"
        :text="t('overview.noneText')"
        :title="t('overview.none')"
      />
    </v-col>
  </v-row>
</template>

<script lang="ts" setup>
  import type { SubmodelRef, SubmodelViewContributionInfo, Target } from '#shared/contract'

  // The views of installed apps (plan D3, D14) for every submodel of the
  // shell, one card each. Each runs in its own sandboxed frame.
  const props = defineProps<{ target: Target, shellId: string, refs: SubmodelRef[] }>()

  const { t } = useI18n()

  const available = computed(() => props.refs.filter(ref => ref.status === 'available' && ref.semanticId))
  const contributions = useAppContributions(() => available.value.map(ref => ref.semanticId!))

  const views = computed(() => {
    const result: Array<{ submodel: SubmodelRef, contribution: SubmodelViewContributionInfo }> = []
    for (const submodel of available.value) {
      // One card per submodel: the first matching view (bundled apps first).
      const matching = (contributions.data.value?.submodelViews ?? [])
        .filter(view => view.reason.semanticId === submodel.semanticId)
        .toSorted((a, b) => Number(b.bundled) - Number(a.bundled))
      if (matching[0]) {
        result.push({ submodel, contribution: matching[0] })
      }
    }
    return result
  })
</script>
