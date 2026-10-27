<template>
  <v-row dense>
    <v-col v-for="entry in entries" :key="entry.marking.path" cols="12" :sm="wide ? 6 : 12">
      <v-card class="h-100" data-test="marking">
        <div class="d-flex align-start ga-3 pa-3">
          <!-- The image in Studio's file viewer, larger. -->
          <v-btn
            :aria-label="t('marking.open', { name: entry.name })"
            class="pa-0"
            :disabled="!entry.marking.file"
            height="72"
            min-width="72"
            width="72"
            @click="entry.marking.file && preview(entry.marking.file)"
          >
            <PreviewImage
              :alt="entry.name"
              :client="client"
              :file="entry.marking.file"
              icon="mdi-check-decagram-outline"
              :submodel-id="submodelId"
            />
          </v-btn>

          <div class="flex-grow-1">
            <div class="d-flex flex-wrap align-center ga-2">
              <span class="text-title-small" data-test="marking-name">{{ entry.name }}</span>

              <v-chip
                v-if="entry.expired"
                color="error"
                data-test="marking-expired"
                size="x-small"
                :text="t('marking.expired')"
              />
            </div>

            <DetailList :rows="entry.rows" />
          </div>
        </div>
      </v-card>
    </v-col>
  </v-row>
</template>

<script lang="ts" setup>
  import type { Marking } from './nameplate'
  import type { StudioClient } from '@basyx/studio-sdk'
  import { computed } from 'vue'
  import { useRowActions } from './actions'
  import DetailList from './DetailList.vue'
  import { useI18n } from './i18n'
  import { markingExpired, markingName, markingRows } from './presentation'
  import PreviewImage from './PreviewImage.vue'

  // The markings with their images, certificates and dates; expired ones marked.
  const props = defineProps<{ client: StudioClient, submodelId: string, markings: Marking[], wide: boolean }>()

  const { t, formatLocale } = useI18n()
  const { canEdit, preview } = useRowActions()

  const entries = computed(() => props.markings.map((marking, index) => ({
    marking,
    name: markingName(t, marking, index, formatLocale.value),
    expired: markingExpired(marking, formatLocale.value),
    rows: markingRows(t, marking, formatLocale.value, canEdit.value),
  })))
</script>
