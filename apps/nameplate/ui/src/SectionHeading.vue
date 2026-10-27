<template>
  <div class="d-flex align-center ga-2 mb-2">
    <v-icon :icon="icon" size="18" />

    <h3 class="text-title-small flex-grow-1">{{ title }}</h3>

    <slot name="actions" />
  </div>
</template>

<script lang="ts" setup>
  // The heading of a part of the nameplate without a card of its own (the
  // markings, the asset specific properties): icon, title and actions, as the
  // header of a section's card.
  defineProps<{ title: string, icon: string }>()
  defineSlots<{
    actions?: () => unknown
  }>()
</script>
