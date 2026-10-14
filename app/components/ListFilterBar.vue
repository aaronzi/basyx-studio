<template>
  <div class="d-flex flex-wrap align-center ga-2 pa-2">
    <v-text-field
      v-model="search"
      :aria-label="placeholder"
      class="flex-grow-1"
      clearable
      density="compact"
      max-width="360"
      min-width="200"
      :placeholder="placeholder"
      prepend-inner-icon="mdi-magnify"
    />

    <v-chip-group
      v-if="options.length > 0"
      v-model="selected"
      column
      multiple
      selected-class="text-primary"
    >
      <v-chip
        v-for="option in options"
        :key="option.value"
        filter
        :prepend-icon="option.icon"
        :text="option.title"
        :value="option.value"
      />
    </v-chip-group>
  </div>
</template>

<script lang="ts" setup>
  import type { FilterOption } from '~/utils/records'

  // Search and filter chips above a record list (infrastructures, targets,
  // apps). Chips of one group (`group:value`) widen the result, groups narrow it.
  defineProps<{
    placeholder: string
    options: FilterOption[]
  }>()
  const search = defineModel<string | null>('search', { required: true })
  const selected = defineModel<string[]>('selected', { required: true })
</script>
