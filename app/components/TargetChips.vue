<template>
  <div class="d-flex flex-wrap ga-2">
    <v-chip :prepend-icon="securityModeIcons[target.securityMode]" :text="t(`security.${target.securityMode}`)" />
    <v-chip :color="stateColor" :text="t(`authState.${target.authenticationState}`)" />
  </div>
</template>

<script lang="ts" setup>
  import type { Target } from '#shared/contract'
  import { securityModeIcons } from '~/utils/aas'

  const props = defineProps<{ target: Target }>()
  const { t } = useI18n()

  const stateColor = computed(() => props.target.authenticationState === 'required' ? 'warning' : 'success')
</script>
