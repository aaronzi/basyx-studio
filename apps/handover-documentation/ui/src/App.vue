<template>
  <v-app>
    <!-- Studio's card shows the view's title. -->
    <v-view-card>

      <v-progress-linear v-if="loading" />

      <v-alert v-else-if="error" class="ma-4" :text="error" type="error" />

      <v-list v-else-if="documents.length > 0" class="px-2" lines="two">
        <v-list-item
          v-for="document in documents"
          :key="document.path"
          :disabled="!document.file"
          :subtitle="document.subtitle"
          :title="document.title"
          @click="preview(document.file)"
        >
          <template #prepend>
            <!-- The document's preview image, else its file's (ADR 0052); its type's icon without one. -->
            <file-thumbnail
              :alt="document.title"
              class="me-4"
              cover
              height="48"
              :source="document.thumbnail"
              width="48"
            >
              <template #icon>
                <v-avatar :color="document.pdf ? 'error' : 'primary'" rounded="lg" variant="tonal">
                  <v-icon :icon="document.pdf ? 'mdi-file-pdf-box' : 'mdi-file-document-outline'" />
                </v-avatar>
              </template>
            </file-thumbnail>
          </template>

          <template v-if="document.file" #append>
            <v-btn
              :aria-label="`Download ${document.title}`"
              icon="mdi-download"
              size="small"
              @click.stop="open(document.file, true)"
            />
          </template>
        </v-list-item>
      </v-list>

      <v-card-text v-else class="text-medium-emphasis">No documents.</v-card-text>
    </v-view-card>
  </v-app>
</template>

<script lang="ts" setup>
  import type { FileSource } from '@basyx/file-viewer/vue'
  import type { Node } from '@basyx/studio-app-kit'
  import type { JsonObject, StudioClient } from '@basyx/studio-sdk'
  import { FileThumbnail, provideFileViewer, withCachedContent } from '@basyx/file-viewer/vue'
  import { child, childrenOf, loadSubmodel, textOf } from '@basyx/studio-app-kit'
  import { StudioError } from '@basyx/studio-sdk'
  import { computed, onMounted, ref } from 'vue'

  const props = defineProps<{ client: StudioClient }>()

  const loading = ref(true)
  const error = ref<string | null>(null)
  const submodel = ref<JsonObject | null>(null)
  const context = ref(props.client.context)
  props.client.onContext(value => (context.value = value))
  const locale = computed(() => context.value.locale)
  provideFileViewer({ locale: () => locale.value })

  /** A File element as the file viewer's thumbnail reads it. */
  function sourceOf (file: Node | undefined): FileSource | null {
    const value = file?.element.value
    if (!file || typeof value !== 'string' || value === '') {
      return null
    }
    return withCachedContent({
      key: `${file.path}:${value}`,
      name: value.split('/').pop() ?? '',
      contentType: typeof file.element.contentType === 'string' ? file.element.contentType : '',
      external: /^https?:\/\//i.test(value) ? value : null,
      load: () => props.client.ui.readFile(props.client.context.submodel!.id, file.path),
    })
  }

  /** First entry of a list (v2: `DocumentVersions`) or the collection itself (v1.2: `DocumentVersion`). */
  function first (node: Node | undefined, plural: string, singular: string): Node | undefined {
    const list = child(node, plural)
    return list ? childrenOf(list)[0] : child(node, singular)
  }

  const documents = computed(() => {
    if (!submodel.value) {
      return []
    }
    const list = child(submodel.value, 'Documents')
    const entries = list ? childrenOf(list) : childrenOf(submodel.value).filter(node => /^document/i.test(String(node.element.idShort)))
    return entries.map(document => {
      const version = first(document, 'DocumentVersions', 'DocumentVersion')
      const file = first(version, 'DigitalFiles', 'DigitalFile')
      const previewFile = child(version, 'PreviewFile')
      const classification = first(document, 'DocumentClassifications', 'DocumentClassification')
      const contentType = typeof file?.element.contentType === 'string' ? file.element.contentType : ''
      const className = textOf(child(classification, 'ClassName'), locale.value)
      const versionName = textOf(child(version, 'Version'), locale.value)
      return {
        path: document.path,
        title: textOf(child(version, 'Title'), locale.value) || String(document.element.idShort),
        subtitle: [className, versionName && `Version ${versionName}`].filter(Boolean).join(' · '),
        file: file?.path ?? null,
        thumbnail: sourceOf(previewFile) ?? sourceOf(file),
        pdf: contentType === 'application/pdf',
      }
    })
  })

  /** Shows the document in Studio's file viewer, full-screen. */
  function preview (path: string | null) {
    if (path) {
      void props.client.ui.previewFile(props.client.context.submodel!.id, path).catch((error_: unknown) => {
        error.value = error_ instanceof StudioError ? error_.message : String(error_)
      })
    }
  }

  function open (path: string | null, download: boolean) {
    if (path) {
      void props.client.ui.openFile(props.client.context.submodel!.id, path, download).catch((error_: unknown) => {
        error.value = error_ instanceof StudioError ? error_.message : String(error_)
      })
    }
  }

  onMounted(async () => {
    try {
      submodel.value = await loadSubmodel(props.client)
    } catch (error_) {
      error.value = error_ instanceof StudioError ? error_.message : String(error_)
    } finally {
      loading.value = false
    }
  })
</script>
