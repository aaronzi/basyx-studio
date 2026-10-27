<template>
  <div class="d-flex flex-column ga-2">
    <!-- Search and the class filter as in Studio's lists (shells, targets):
         the classes are in a menu that opens from the field (click or ↓);
         one chip in the field says how many apply. -->
    <v-menu
      v-if="searchable"
      v-model="menu"
      :close-on-content-click="false"
      location="bottom start"
      :open-on-click="false"
    >
      <template #activator="{ props: activator }">
        <v-text-field
          v-bind="activator"
          :aria-label="t('list.search')"
          clearable
          data-test="document-search"
          density="compact"
          :model-value="query"
          :placeholder="t('list.search')"
          prepend-inner-icon="mdi-magnify"
          @click="menu = options.length > 1"
          @keydown.down.prevent="menu = options.length > 1"
          @keydown.esc="menu = false"
          @update:model-value="search"
        >
          <template v-if="classes.length > 0" #default>
            <v-chip
              :aria-label="t('list.removeFilters')"
              class="ms-n1 me-2"
              closable
              color="primary"
              data-test="document-filters"
              prepend-icon="mdi-filter-variant"
              :text="t(classes.length === 1 ? 'list.filter' : 'list.filters', { count: classes.length })"
              @click.stop="menu = true"
              @click:close.stop="classes = []"
            />
          </template>

          <!-- A hint that the field has filters, not a second way to open them. -->
          <template v-if="options.length > 1" #append-inner>
            <v-icon :color="classes.length > 0 ? 'primary' : undefined" icon="mdi-filter-variant" />
          </template>
        </v-text-field>
      </template>

      <v-card min-width="280">
        <v-list
          v-model:selected="classes"
          data-test="document-classes"
          max-height="420"
          select-strategy="leaf"
          selectable
        >
          <v-list-subheader :title="t('list.classes')" />

          <v-list-item
            v-for="option in options"
            :key="option.value"
            prepend-icon="mdi-tag-outline"
            :title="option.title"
            :value="option.value"
          >
            <template #append="{ isSelected }">
              <v-icon v-if="isSelected" color="primary" icon="mdi-check" size="small" />
            </template>
          </v-list-item>
        </v-list>
      </v-card>
    </v-menu>

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
  import { ref } from 'vue'
  import { latestVersion } from './handoverDocumentation'
  import { useI18n } from './i18n'
  import { documentSubtitle } from './presentation'
  import PreviewImage from './PreviewImage.vue'

  // The documents: their preview, title, class and version, with a search
  // and a filter by class where there is more than one.
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
  const menu = ref(false)

  /** Typing closes the filter menu; the clear button sends `null`, which is no search. */
  function search (value: string | null) {
    query.value = value ?? ''
    menu.value = false
  }

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
