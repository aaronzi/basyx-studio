<template>
  <div class="json-panel">
    <div class="d-flex align-center ga-2 px-4 py-2">
      <span class="text-body-medium text-medium-emphasis text-truncate">{{ label }}</span>
      <v-spacer />

      <v-btn
        :aria-label="t('shell.details')"
        :icon="copied ? 'mdi-check' : 'mdi-content-copy'"
        size="small"
        variant="text"
        @click="copy"
      />
    </div>

    <v-divider />
    <pre class="json-panel__content pa-4">{{ text }}</pre>
  </div>
</template>

<script lang="ts" setup>
  const props = defineProps<{ value: unknown, label: string }>()
  const { t } = useI18n()

  const text = computed(() => JSON.stringify(props.value, null, 2))
  const copied = ref(false)

  async function copy () {
    await navigator.clipboard.writeText(text.value)
    copied.value = true
    setTimeout(() => (copied.value = false), 1500)
  }
</script>

<style scoped>
.json-panel__content {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.8125rem;
  line-height: 1.5;
  overflow: auto;
  white-space: pre;
}
</style>
