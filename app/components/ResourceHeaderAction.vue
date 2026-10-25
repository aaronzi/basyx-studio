<template>
  <!-- An inline action of ResourceHeader: a button, or a button with a menu of links. -->
  <v-menu v-if="action.items">
    <template #activator="{ props: activator }">
      <v-btn
        v-bind="activator"
        append-icon="mdi-chevron-down"
        :color="action.primary ? 'primary' : undefined"
        :prepend-icon="action.icon"
        :text="action.title"
        :variant="action.primary ? 'tonal' : undefined"
      />
    </template>

    <v-card>
      <v-list>
        <v-list-item
          v-for="item in action.items"
          :key="item.href"
          :href="item.href"
          :prepend-icon="item.icon"
          :subtitle="item.subtitle"
          :title="item.title"
        />
      </v-list>
    </v-card>
  </v-menu>

  <v-btn
    v-else
    :color="action.primary ? 'primary' : undefined"
    :prepend-icon="action.icon"
    :text="action.title"
    :variant="action.primary ? 'tonal' : undefined"
    @click="action.onClick?.()"
  />
</template>

<script lang="ts" setup>
  import type { HeaderAction } from '~/utils/resource-header'

  defineProps<{ action: HeaderAction }>()
</script>
