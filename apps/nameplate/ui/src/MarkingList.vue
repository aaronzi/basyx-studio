<template>
  <div class="d-flex flex-wrap ga-2">
    <!-- Compact cards as the 3D Models app's model switcher; the details open in a dialog. -->
    <v-card
      v-for="entry in entries"
      :key="entry.marking.path"
      :aria-label="t('marking.open', { name: entry.name })"
      data-test="marking"
      width="240"
      @click="emit('open', entry.marking)"
    >
      <v-card-item class="pa-2">
        <template #prepend>
          <v-sheet
            border
            class="overflow-hidden"
            height="44"
            rounded
            width="44"
          >
            <PreviewImage
              :alt="entry.name"
              :client="client"
              :file="entry.marking.file"
              height="44"
              icon="mdi-check-decagram-outline"
              :submodel-id="submodelId"
              width="44"
            />
          </v-sheet>
        </template>

        <v-card-title class="text-body-small font-weight-medium" data-test="marking-name">{{ entry.name }}</v-card-title>
        <v-card-subtitle class="text-body-small">{{ entry.subtitle }}</v-card-subtitle>

        <template v-if="entry.expired" #append>
          <v-chip
            color="error"
            data-test="marking-expired"
            size="x-small"
            :text="t('marking.expired')"
          />
        </template>
      </v-card-item>
    </v-card>
  </div>
</template>

<script lang="ts" setup>
  import type { Marking } from './nameplate'
  import type { StudioClient } from '@basyx/studio-sdk'
  import { computed } from 'vue'
  import { useI18n } from './i18n'
  import { markingExpired, markingName, markingSubtitle } from './presentation'
  import PreviewImage from './PreviewImage.vue'

  // The markings as compact cards with their images; a click shows a
  // marking's certificate, dates and notes (MarkingDialog).
  const props = defineProps<{ client: StudioClient, submodelId: string, markings: Marking[] }>()
  const emit = defineEmits<{ open: [marking: Marking] }>()

  const { t, formatLocale } = useI18n()

  const entries = computed(() => props.markings.map((marking, index) => ({
    marking,
    name: markingName(t, marking, index, formatLocale.value),
    subtitle: markingSubtitle(t, marking, formatLocale.value),
    expired: markingExpired(marking, formatLocale.value),
  })))
</script>
