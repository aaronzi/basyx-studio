<template>
  <v-alert
    border="start"
    :icon="icon"
    :title="message"
    :type="type"
    variant="tonal"
  >
    <div v-if="detail" class="text-body-medium">{{ detail }}</div>

    <div v-if="apiError?.problem" class="text-body-small text-medium-emphasis mt-1">
      {{ t('problem.requestId') }}: {{ apiError.problem.requestId }}
    </div>

    <template v-if="retry && retryable" #append>
      <v-btn size="small" :text="t('problem.retry')" variant="text" @click="emit('retry')" />
    </template>
  </v-alert>
</template>

<script lang="ts" setup>
  import { StudioApiError } from '~/composables/useStudioApi'

  const props = defineProps<{
    error: unknown
    retry?: boolean
  }>()
  const emit = defineEmits<{ retry: [] }>()

  const { t, te } = useI18n()

  const apiError = computed(() => props.error instanceof StudioApiError ? props.error : null)
  const code = computed(() => apiError.value?.code ?? 'internal_error')
  const message = computed(() => te(`problem.${code.value}`) ? t(`problem.${code.value}`) : t('problem.internal_error'))
  // Show the server's detail when it adds information beyond the generic message.
  const detail = computed(() => {
    const problem = apiError.value?.problem
    return problem?.detail && problem.detail !== problem.title ? problem.detail : null
  })
  const retryable = computed(() => apiError.value?.problem?.retryable ?? true)
  const type = computed(() => ['target_forbidden', 'forbidden', 'target_resource_not_found', 'not_found'].includes(code.value) ? 'warning' : 'error')
  const icon = computed(() => code.value.includes('forbidden') ? 'mdi-lock-outline' : undefined)
</script>
