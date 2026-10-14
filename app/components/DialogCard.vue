<template>
  <!-- The card of every dialog, as in the BaSyx AAS Web UI: a tinted header
       and dividers that set the header, the body and the actions apart.
       Further actions go on the left (`actions-start`, v-btn-secondary),
       cancel and the main action on the right (`actions`). -->
  <v-card>
    <v-card-item class="bg-dialog-header flex-shrink-0" :prepend-icon="prependIcon">
      <v-card-title>{{ title }}</v-card-title>
      <v-card-subtitle v-if="subtitle">{{ subtitle }}</v-card-subtitle>

      <template v-if="closable" #append>
        <v-btn :aria-label="t('common.close')" icon="mdi-close" size="small" @click="emit('close')" />
      </template>
    </v-card-item>

    <v-divider />

    <v-card-text :class="flush ? 'pa-0' : 'pt-4'">
      <slot />
    </v-card-text>

    <template v-if="$slots.actions || $slots['actions-start']">
      <v-divider />

      <v-card-actions class="px-4">
        <slot name="actions-start" />
        <v-spacer />
        <slot name="actions" />
      </v-card-actions>
    </template>
  </v-card>
</template>

<script lang="ts" setup>
  defineProps<{
    title: string
    subtitle?: string | null
    prependIcon?: string
    /** A close button in the header, for dialogs without a cancel action. */
    closable?: boolean
    /** The body without padding, e.g. for a list or an editor. */
    flush?: boolean
  }>()
  const emit = defineEmits<{ close: [] }>()
  defineSlots<{
    'default'?: () => unknown
    'actions'?: () => unknown
    'actions-start'?: () => unknown
  }>()

  const { t } = useI18n()
</script>
