<template>
  <!-- A package's Save and Close are the package bar's (package editing plan, H5). -->
  <div class="d-flex flex-wrap align-center ga-2">
    <TargetChips :target="target" />

    <v-btn
      v-if="target.authenticationState === 'authenticated'"
      prepend-icon="mdi-account-cancel-outline"
      size="small"
      :text="t('target.revoke')"
      @click="revoke"
    />
  </div>
</template>

<script lang="ts" setup>
  import type { Target } from '#shared/contract'

  const props = defineProps<{ target: Target }>()

  const { t } = useI18n()
  const api = useStudioApi()
  const invalidate = useInvalidate()

  async function revoke () {
    await api(`/targets/${props.target.id}/authorization`, { method: 'DELETE' })
    // Drop everything cached for this target, then reload its state.
    await invalidate(['targets', props.target.id])
  }
</script>
