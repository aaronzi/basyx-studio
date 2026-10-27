<template>
  <!-- In the frame Studio shows alone over its dimmed page (openFullscreen without
       header), so the dialog has the whole window; Studio dims, so it does not. -->
  <v-dialog
    max-width="640"
    :model-value="true"
    :persistent="!entered"
    :scrim="false"
    scrollable
    @after-enter="entered = true"
    @update:model-value="emit('close')"
  >
    <v-card data-test="marking-dialog">
      <v-card-item>
        <v-card-title class="text-break" data-test="marking-dialog-name">{{ name }}</v-card-title>
        <v-card-subtitle v-if="subtitle" class="text-break">{{ subtitle }}</v-card-subtitle>

        <template #append>
          <v-chip
            v-if="expired"
            class="me-2"
            color="error"
            data-test="marking-dialog-expired"
            :text="t('marking.expired')"
          />

          <v-btn
            :aria-label="t('nameplate.close')"
            data-test="marking-dialog-close"
            icon="mdi-close"
            size="small"
            @click="emit('close')"
          />
        </template>
      </v-card-item>

      <v-divider />

      <v-card-text class="d-flex flex-column ga-4">
        <v-alert
          v-if="notice"
          closable
          data-test="notice"
          density="compact"
          :text="notice.text"
          :type="notice.type"
          @click:close="emit('dismiss')"
        />

        <!-- The image in Studio's file viewer, larger still. -->
        <v-card
          :aria-label="t('marking.preview', { name })"
          data-test="marking-dialog-image"
          :disabled="!marking.file"
          height="200"
          @click="marking.file && preview(marking.file)"
        >
          <PreviewImage
            :alt="name"
            :client="client"
            :file="marking.file"
            height="200"
            icon="mdi-check-decagram-outline"
            :submodel-id="submodelId"
            width="100%"
          />
        </v-card>

        <DetailList v-if="rows.length > 0" :rows="rows" />
      </v-card-text>
    </v-card>
  </v-dialog>
</template>

<script lang="ts" setup>
  import type { Marking } from './nameplate'
  import type { StudioClient } from '@basyx/studio-sdk'
  import { computed, ref } from 'vue'
  import { useRowActions } from './actions'
  import DetailList from './DetailList.vue'
  import { useI18n } from './i18n'
  import { markingExpired, markingName, markingRows, markingSubtitle } from './presentation'
  import PreviewImage from './PreviewImage.vue'

  // A marking's image, certificate, dates and notes; in edit mode each value
  // changes in place, as in the view.
  const props = defineProps<{ client: StudioClient, submodelId: string, marking: Marking, index: number, notice: { type: 'success' | 'error', text: string } | null }>()
  const emit = defineEmits<{ close: [], dismiss: [] }>()

  const { t, formatLocale } = useI18n()
  /** A click while the dialog fades in is not taken for one outside it. */
  const entered = ref(false)
  const { canEdit, preview } = useRowActions()

  const name = computed(() => markingName(t, props.marking, props.index, formatLocale.value))
  const subtitle = computed(() => markingSubtitle(t, props.marking, formatLocale.value))
  const expired = computed(() => markingExpired(props.marking, formatLocale.value))
  const rows = computed(() => markingRows(t, props.marking, formatLocale.value, canEdit.value))
</script>
