<template>
  <div class="d-flex flex-column h-100">
    <v-toolbar color="transparent" density="compact">
      <v-toolbar-title class="text-body-medium text-medium-emphasis">{{ label }}</v-toolbar-title>

      <template #append>
        <v-btn
          :aria-label="t('shell.copyJson')"
          :icon="copied ? 'mdi-check' : 'mdi-content-copy'"
          size="small"
          @click="copy"
        />
      </template>
    </v-toolbar>

    <v-divider />

    <v-code class="flex-grow-1 overflow-auto text-mono text-pre text-body-small pa-4" rounded="0" tag="pre">{{ text }}</v-code>
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
