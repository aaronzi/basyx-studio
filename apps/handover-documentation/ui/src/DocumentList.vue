<template>
  <div class="d-flex flex-column ga-2">
    <v-text-field
      v-if="searchable"
      v-model="query"
      :aria-label="t('list.search')"
      clearable
      data-test="document-search"
      :placeholder="t('list.search')"
      prepend-inner-icon="mdi-magnify"
    />

    <v-chip-group
      v-if="options.length > 1"
      v-model="classes"
      column
      data-test="document-classes"
      filter
      multiple
    >
      <v-chip v-for="option in options" :key="option.value" :text="option.title" :value="option.value" />
    </v-chip-group>

    <div v-if="documents.length < total" class="text-body-small text-medium-emphasis" data-test="document-count">
      {{ t('list.filtered', { count: documents.length, total }) }}
    </div>

    <v-list
      v-if="documents.length > 0"
      class="overflow-y-auto pa-0"
      lines="two"
      :max-height="maxHeight"
    >
      <v-list-item
        v-for="document in documents"
        :key="document.key"
        :active="document.key === selectedKey"
        color="primary"
        data-test="document-item"
        :subtitle="subtitle(document)"
        :title="titleOf(document)"
        @click="emit('select', document.key)"
      >
        <template #prepend>
          <v-sheet
            border
            class="overflow-hidden me-3"
            height="44"
            rounded
            width="44"
          >
            <PreviewImage
              :alt="titleOf(document)"
              :client="client"
              :file="thumbnailOf(document)"
              icon-size="22"
              :submodel-id="submodelId"
            />
          </v-sheet>
        </template>
      </v-list-item>
    </v-list>

    <div v-else class="text-body-medium text-medium-emphasis pa-2" data-test="no-match">{{ t('list.noMatch') }}</div>
  </div>
</template>

<script lang="ts" setup>
  import type { FileRef, HandoverDocument } from './handoverDocumentation'
  import type { StudioClient } from '@basyx/studio-sdk'
  import { detectViewerKind } from '@basyx/file-viewer'
  import { latestVersion } from './handoverDocumentation'
  import { useI18n } from './i18n'
  import { documentSubtitle } from './presentation'
  import PreviewImage from './PreviewImage.vue'

  // The documents: their preview, title, class and version, with a search
  // and a filter by class where there are enough of them to need one.
  withDefaults(defineProps<{
    client: StudioClient
    submodelId: string
    /** The documents the filter lets through. */
    documents: HandoverDocument[]
    total: number
    selectedKey: string
    options: Array<{ value: string, title: string }>
    searchable: boolean
    titleOf: (document: HandoverDocument) => string
    maxHeight?: number | string
  }>(), { maxHeight: 640 })
  const emit = defineEmits<{ select: [key: string] }>()
  const query = defineModel<string>('query', { required: true })
  const classes = defineModel<string[]>('classes', { required: true })

  const { t, formatLocale } = useI18n()

  function subtitle (document: HandoverDocument): string {
    return documentSubtitle(t, document, latestVersion(document.versions), formatLocale.value)
  }

  /** The preview image, else the first file that is an image. */
  function thumbnailOf (document: HandoverDocument): FileRef | null {
    const version = latestVersion(document.versions)
    return version?.preview
      ?? version?.digitalFiles.find(file => !file.external && detectViewerKind({ contentType: file.contentType, fileName: file.name }).kind === 'image')
      ?? null
  }
</script>
