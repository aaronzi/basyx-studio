<template>
  <div class="d-flex flex-wrap ga-2">
    <template v-if="target.workspace">
      <v-chip :prepend-icon="targetIcon(target)" :text="t('workspace.localFile')" />

      <v-chip
        :color="target.workspace.unsavedChanges ? 'warning' : 'success'"
        :text="t(target.workspace.unsavedChanges ? 'workspace.unsaved' : 'workspace.saved')"
      />
    </template>

    <template v-else-if="target.securityMode">
      <v-chip :prepend-icon="targetIcon(target)" :text="t(`security.${target.securityMode}`)" />
      <v-chip :color="stateColor" :text="t(`authState.${target.authenticationState}`)" />
    </template>
  </div>
</template>

<script lang="ts" setup>
  import type { Target } from '#shared/contract'
  import { targetIcon } from '~/utils/aas'

  const props = defineProps<{ target: Target }>()
  const { t } = useI18n()

  const stateColor = computed(() => props.target.authenticationState === 'required' ? 'warning' : 'success')
</script>
