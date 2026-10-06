<template>
  <div class="d-flex flex-wrap ga-2">
    <v-chip
      label
      :prepend-icon="securityModeIcons[target.securityMode]"
      size="small"
      :text="t(`security.${target.securityMode}`)"
      variant="tonal"
    />

    <v-chip
      :color="stateColor"
      label
      size="small"
      :text="t(`authState.${target.authenticationState}`)"
      variant="tonal"
    />
  </div>
</template>

<script lang="ts" setup>
  import type { Target } from '#shared/contract'
  import { securityModeIcons } from '~/utils/aas'

  const props = defineProps<{ target: Target }>()
  const { t } = useI18n()

  const stateColor = computed(() => props.target.authenticationState === 'required' ? 'warning' : 'success')
</script>
