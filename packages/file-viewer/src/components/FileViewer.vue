<template>
  <div class="d-flex flex-column h-100" data-test="file-viewer">
    <v-toolbar class="flex-shrink-0">
      <div class="d-flex align-center ga-2 ms-4 overflow-hidden">
        <v-icon :icon="viewerKindIcon(info)" />

        <span class="text-body-medium text-truncate" data-test="file-viewer-name">{{ source?.name }}</span>

        <v-chip v-if="state.dirty.value" color="warning" data-test="file-viewer-unsaved" :text="t('status.unsaved')" />
      </div>

      <template #append>
        <div class="d-flex align-center ga-1 me-2">
          <!-- Buttons that come and go (text, unsaved changes) stay left of the
               fixed ones, so the toggle at the far right never moves. -->
          <template v-if="showsText">
            <v-btn
              v-tooltip="t('actions.find')"
              :aria-label="t('actions.find')"
              icon="mdi-magnify"
              size="small"
              @click="textView?.find()"
            />

            <v-btn
              v-tooltip="state.wrap.value ? t('actions.noWrap') : t('actions.wrap')"
              :aria-label="state.wrap.value ? t('actions.noWrap') : t('actions.wrap')"
              :icon="state.wrap.value ? 'mdi-wrap-disabled' : 'mdi-wrap'"
              size="small"
              @click="state.toggleWrap()"
            />
          </template>

          <template v-if="state.dirty.value">
            <v-btn data-test="file-viewer-discard" :disabled="state.saving.value" :text="t('actions.discard')" @click="state.discard()" />

            <v-btn-primary
              data-test="file-viewer-save"
              :loading="state.saving.value"
              prepend-icon="mdi-content-save-outline"
              :text="t('actions.save')"
              @click="state.save()"
            />
          </template>

          <v-btn
            v-tooltip="t('actions.download')"
            :aria-label="t('actions.download')"
            data-test="file-viewer-download"
            :disabled="!downloadable"
            icon="mdi-download"
            size="small"
            @click="download"
          />

          <v-btn
            v-if="source?.external"
            v-tooltip="t('actions.openExternal')"
            :aria-label="t('actions.openExternal')"
            :href="source.external"
            icon="mdi-open-in-new"
            rel="noopener noreferrer"
            size="small"
            target="_blank"
          />

          <v-btn
            v-if="fullscreen"
            v-tooltip="t('actions.close')"
            :aria-label="t('actions.close')"
            data-test="file-viewer-close"
            icon="mdi-close"
            size="small"
            @click="emit('close')"
          />

          <v-btn
            v-else-if="maximizable"
            v-tooltip="t('actions.maximize')"
            :aria-label="t('actions.maximize')"
            data-test="file-viewer-maximize"
            icon="mdi-fullscreen"
            size="small"
            @click="emit('maximize')"
          />

          <v-btn-toggle
            v-if="info.alternate && state.status.value === 'ready'"
            data-test="file-viewer-views"
            mandatory
            :model-value="state.showSource.value"
            @update:model-value="state.setShowSource"
          >
            <v-btn :text="primaryViewLabel" :value="false" />
            <v-btn :text="t('views.source')" :value="true" />
          </v-btn-toggle>
        </div>
      </template>
    </v-toolbar>

    <v-divider />

    <v-sheet class="d-flex flex-column flex-grow-1 position-relative overflow-hidden" color="transparent" :min-height="minHeight" rounded="0">
      <!-- A card for its stacking context (z-index 0): Monaco's layers stay
           inside it, so the alerts below float above them. -->
      <v-card
        :border="false"
        class="d-flex flex-column flex-grow-1"
        color="transparent"
        flat
        rounded="0"
      >
        <div v-if="state.status.value === 'loading' || state.status.value === 'idle'" class="d-flex flex-column flex-grow-1 align-center justify-center ga-3 pa-8 text-medium-emphasis">
          <v-progress-circular indeterminate />

          <span class="text-body-medium">{{ t('status.loading') }}</span>
        </div>

        <v-empty-state
          v-else-if="state.status.value === 'error'"
          data-test="file-viewer-error"
          icon="mdi-file-alert-outline"
          size="56"
          :text="errorText"
          :title="t('status.failed')"
        >
          <template #actions>
            <v-btn
              v-if="source?.external"
              :href="source.external"
              prepend-icon="mdi-open-in-new"
              rel="noopener noreferrer"
              target="_blank"
              :text="t('actions.openExternal')"
            />

            <v-btn prepend-icon="mdi-refresh" :text="t('actions.retry')" @click="state.retry()" />
          </template>
        </v-empty-state>

        <v-empty-state
          v-else-if="state.content.value?.bytes.length === 0"
          data-test="file-viewer-empty"
          icon="mdi-file-outline"
          size="56"
          :title="t('status.empty')"
        />

        <template v-else>
          <TextView
            v-if="showsText"
            ref="textView"
            :state="state"
            @save="state.save()"
          />

          <MarkdownView v-else-if="info.kind === 'text' && info.alternate === 'markdown'" :text="state.text.value" />

          <CsvView v-else-if="info.kind === 'text' && info.alternate === 'csv'" :delimiter="info.delimiter" :text="state.text.value" />

          <ImageView v-else-if="info.kind === 'image'" :content="state.content.value!" :name="source?.name ?? ''" :svg="info.alternate === 'svg'" />

          <PdfView v-else-if="info.kind === 'pdf'" :bytes="state.content.value!.bytes" :state="state" />

          <ModelView v-else-if="info.kind === 'model3d' && info.modelFormat" :bytes="state.content.value!.bytes" :format="info.modelFormat" />

          <MediaView v-else-if="info.kind === 'video' || info.kind === 'audio'" :content="state.content.value!" :kind="info.kind" :type="source?.contentType ?? ''" />

          <v-empty-state
            v-else
            data-test="file-viewer-none"
            icon="mdi-file-eye-outline"
            size="56"
            :text="t('status.noPreviewText')"
            :title="t('status.noPreview')"
          >
            <template #actions>
              <v-btn-primary prepend-icon="mdi-download" :text="t('actions.download')" @click="download" />
            </template>
          </v-empty-state>
        </template>
      </v-card>

      <!-- Messages float above the content, opaque (flat), wrap in full and stay until closed. -->
      <div v-if="alerts" class="position-absolute top-0 left-0 right-0 d-flex flex-column ga-2 pa-2" data-test="file-viewer-alerts">
        <v-alert
          v-if="conflict"
          data-test="file-viewer-conflict"
          elevation="4"
          type="warning"
          variant="flat"
        >
          <div class="text-body-medium">{{ t('status.conflict') }}</div>

          <div class="d-flex flex-wrap ga-2 mt-2">
            <v-btn :text="t('actions.downloadMine')" @click="downloadText" />
            <v-btn :text="t('actions.reload')" @click="reloadDiscarding" />
            <v-btn :text="t('actions.keepMine')" @click="state.save()" />
          </div>
        </v-alert>

        <v-alert
          v-else-if="state.saveError.value"
          closable
          data-test="file-viewer-save-error"
          elevation="4"
          :text="saveErrorText"
          type="error"
          variant="flat"
          @click:close="state.clearSaveError()"
        />

        <v-alert
          v-if="showDraftOutdated"
          closable
          elevation="4"
          :text="t('status.draftOutdated')"
          type="warning"
          variant="flat"
          @click:close="dismissed.add('draftOutdated')"
        />

        <v-alert
          v-if="showTruncated"
          closable
          data-test="file-viewer-truncated"
          elevation="4"
          :text="t('status.truncated', { size: formatSize(state.content.value!.bytes.length, formatLocale()), shown: formatSize(truncatedTextLength, formatLocale()) })"
          type="info"
          variant="flat"
          @click:close="dismissed.add('truncated')"
        />

        <v-alert
          v-else-if="readOnlyHint && !dismissed.has('readOnly')"
          closable
          density="compact"
          elevation="4"
          :text="readOnlyHint"
          type="info"
          variant="flat"
          @click:close="dismissed.add('readOnly')"
        />
      </div>
    </v-sheet>
  </div>
</template>

<script lang="ts" setup>
  import type { FileViewerState } from '../state.ts'
  import { computed, defineAsyncComponent, onMounted, reactive, useTemplateRef, watch } from 'vue'
  import { VAlert } from 'vuetify/components/VAlert'
  import { VBtn } from 'vuetify/components/VBtn'
  import { VBtnToggle } from 'vuetify/components/VBtnToggle'
  import { VCard } from 'vuetify/components/VCard'
  import { VChip } from 'vuetify/components/VChip'
  import { VDivider } from 'vuetify/components/VDivider'
  import { VEmptyState } from 'vuetify/components/VEmptyState'
  import { VIcon } from 'vuetify/components/VIcon'
  import { VProgressCircular } from 'vuetify/components/VProgressCircular'
  import { VSheet } from 'vuetify/components/VSheet'
  import { VToolbar } from 'vuetify/components/VToolbar'
  import { formatSize, useFileViewerContext } from '../i18n.ts'
  import { viewerKindIcon } from '../kinds.ts'
  import { FileConflictError } from '../state.ts'
  import { truncatedTextLength, UnencodableTextError } from '../text.ts'
  import CsvView from './CsvView.vue'
  import ImageView from './ImageView.vue'
  import MarkdownView from './MarkdownView.vue'
  import MediaView from './MediaView.vue'
  import TextView from './TextView.vue'

  // The file viewer: one file of any kind, with the same toolbar and states
  // wherever it shows (ADR 0052). The host builds the state from a source and
  // decides what maximize opens; inline and full-screen share the state.
  const props = defineProps<{
    state: FileViewerState
    /** Shown in a full-screen dialog: the toolbar closes it instead of maximizing. */
    fullscreen?: boolean
    /** Offers the maximize button, which emits `maximize`. */
    maximizable?: boolean
    minHeight?: number | string
  }>()
  const emit = defineEmits<{ maximize: [], close: [] }>()

  // PDF.js and three.js load only for their files.
  const PdfView = defineAsyncComponent(() => import('./PdfView.vue'))
  const ModelView = defineAsyncComponent(() => import('./ModelView.vue'))

  const { t, formatLocale } = useFileViewerContext()
  const textView = useTemplateRef<InstanceType<typeof TextView>>('textView')

  const source = computed(() => props.state.source.value)
  const info = computed(() => props.state.info.value)
  /** The text editor shows: a text without a second view, or its source. */
  const showsText = computed(() => props.state.status.value === 'ready'
    && (props.state.content.value?.bytes.length ?? 0) > 0
    && ((info.value.kind === 'text' && (!info.value.alternate || props.state.showSource.value)) || (info.value.alternate === 'svg' && props.state.showSource.value)))
  const primaryViewLabel = computed(() => {
    switch (info.value.alternate) {
      case 'csv': {
        return t('views.table')
      }
      case 'svg': {
        return t('views.image')
      }
      default: {
        return t('views.rendered')
      }
    }
  })
  const downloadable = computed(() => Boolean(props.state.content.value))
  const conflict = computed(() => props.state.saveError.value instanceof FileConflictError)

  const saveErrorText = computed(() => {
    const error = props.state.saveError.value
    if (error instanceof UnencodableTextError) {
      return t('status.unencodable', { character: error.character })
    }
    return error instanceof Error ? error.message : String(error)
  })
  const errorText = computed(() => {
    const error = props.state.error.value
    return error instanceof Error ? error.message : (error ? String(error) : '')
  })
  /** Why a text the host would let the user change stays read-only. */
  const readOnlyHint = computed(() => {
    if (info.value.kind !== 'text' || props.state.status.value !== 'ready') {
      return null
    }
    switch (props.state.readOnlyReason.value) {
      case 'external': {
        return source.value?.save ? t('status.readOnlyExternal') : null
      }
      case 'encoding': {
        return t('status.readOnlyEncoding')
      }
      default: {
        return null
      }
    }
  })

  /** Notes the user closed; a new file shows them again. */
  const dismissed = reactive(new Set<string>())
  watch(() => source.value?.key, () => dismissed.clear())
  const showDraftOutdated = computed(() => props.state.draftOutdated.value && props.state.dirty.value && !conflict.value && !dismissed.has('draftOutdated'))
  const showTruncated = computed(() => Boolean(props.state.decoded.value?.truncated) && !dismissed.has('truncated'))
  const alerts = computed(() => conflict.value || Boolean(props.state.saveError.value) || showDraftOutdated.value || showTruncated.value
    || (Boolean(readOnlyHint.value) && !dismissed.has('readOnly')))

  function save (blob: Blob, name: string) {
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = name
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  /** The file as it is stored (unsaved changes are not part of it). */
  function download () {
    const content = props.state.content.value
    if (content && source.value) {
      save(new Blob([content.bytes as BlobPart], { type: source.value.contentType || content.contentType }), source.value.name)
    }
  }

  /** The unsaved text, e.g. before loading the current version over it. */
  function downloadText () {
    if (source.value) {
      save(new Blob([props.state.text.value], { type: 'text/plain;charset=utf-8' }), source.value.name)
    }
  }

  function reloadDiscarding () {
    props.state.discard()
    props.state.retry()
  }

  onMounted(() => void props.state.load())
  // A new file in the same viewer.
  watch(() => props.state.status.value, status => {
    if (status === 'idle') {
      void props.state.load()
    }
  })
</script>
