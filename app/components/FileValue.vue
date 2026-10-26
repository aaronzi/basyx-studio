<template>
  <v-card border="0" color="surface-light" data-test="file-value">
    <v-list-item class="py-3" :subtitle="subtitle" :title="title">
      <template #prepend>
        <v-avatar :color="kind.kind === 'pdf' ? 'error' : 'primary'" variant="tonal">
          <v-icon :icon="viewerKindIcon(kind)" />
        </v-avatar>
      </template>
    </v-list-item>

    <!-- A small picture only; the file itself shows in the Visualization tab or full-screen. -->
    <div v-if="source" class="px-4 pb-2">
      <FileThumbnail :source="source" />
    </div>

    <v-card-actions v-if="source">
      <v-btn data-test="file-show-preview" prepend-icon="mdi-eye-outline" :text="t('details.showPreview')" @click="emit('preview')" />

      <v-btn
        v-tooltip="t('details.fullScreen')"
        :aria-label="t('details.fullScreen')"
        data-test="file-maximize"
        icon="mdi-fullscreen"
        @click="emit('maximize')"
      />

      <v-btn
        v-if="external"
        v-tooltip="t('details.openExternal')"
        :aria-label="t('details.openExternal')"
        :href="external"
        icon="mdi-open-in-new"
        rel="noopener noreferrer"
        target="_blank"
      />

      <v-btn
        v-tooltip="t('details.download')"
        :aria-label="t('details.download')"
        data-test="file-download"
        :download="downloadUrl ? source.name : undefined"
        :href="external ?? downloadUrl ?? `${attachmentUrl}?download`"
        icon="mdi-download"
        :rel="external ? 'noopener noreferrer' : undefined"
        :target="external ? '_blank' : undefined"
      />

      <v-spacer />

      <v-btn v-if="canReplace && isFile" prepend-icon="mdi-upload" :text="t('details.replace')" @click="dialog = true" />
    </v-card-actions>

    <v-card-actions v-else-if="canReplace && isFile">
      <v-spacer />
      <v-btn prepend-icon="mdi-upload" :text="t('details.replace')" @click="dialog = true" />
    </v-card-actions>

    <v-dialog v-model="dialog" max-width="480">
      <DialogCard :title="t('details.replaceTitle', { name: element.idShort })">
        <v-file-input v-model="file" :label="t('details.chooseFile')" prepend-icon="" prepend-inner-icon="mdi-paperclip" />
        <ProblemAlert v-if="error" class="mt-4" :error="error" />

        <template #actions>
          <v-btn :text="t('common.cancel')" @click="dialog = false" />
          <v-btn-primary :disabled="!file" :loading="saving" :text="t('details.replace')" @click="replace" />
        </template>
      </DialogCard>
    </v-dialog>
  </v-card>
</template>

<script lang="ts" setup>
  import type { ElementDetail } from '#shared/contract'
  import type { FileSource } from '@basyx/file-viewer/vue'
  import { detectViewerKind, viewerKindIcon } from '@basyx/file-viewer'
  import { FileThumbnail } from '@basyx/file-viewer/vue'
  import { externalFile, fileNameOf } from '~/composables/useElementFile'

  // A File or Blob element in the details tab (ADR 0052): what it is, a
  // thumbnail, and the ways to see it — the Visualization tab's file view,
  // full-screen — download it or, for a File, replace it.
  const props = defineProps<{
    targetId: string
    submodelKey: string
    detail: ElementDetail
    /** The file viewer's source of the element, or `null` without content. */
    source: FileSource | null
    canReplace: boolean
  }>()
  const emit = defineEmits<{ changed: [detail: ElementDetail], preview: [], maximize: [] }>()

  const { t, locale } = useI18n()
  const api = useStudioApi()
  const notifications = useNotificationsStore()

  const element = computed(() => props.detail.value as Record<string, unknown>)
  const isFile = computed(() => element.value.modelType === 'File')
  const contentType = computed(() => String(element.value.contentType ?? ''))
  const external = computed(() => externalFile(element.value))
  const kind = computed(() => detectViewerKind({ contentType: contentType.value, fileName: props.source?.name ?? fileNameOf(element.value) }))
  /** A Blob's size from its base64 value. */
  const blobBytes = computed(() => {
    const value = element.value.value
    return !isFile.value && typeof value === 'string' && value ? Math.floor(value.replace(/=+$/, '').length * 3 / 4) : null
  })
  const title = computed(() => {
    if (isFile.value) {
      return fileNameOf(element.value) || t('details.noFile')
    }
    return blobBytes.value === null ? t('details.blobEmpty') : t('details.bytes', { size: blobBytes.value.toLocaleString(locale.value) })
  })
  const subtitle = computed(() => [
    isFile.value ? null : t('details.blob', { type: contentType.value }),
    isFile.value ? contentType.value : null,
    external.value ? t('details.externalFile', { host: URL.parse(external.value)?.host ?? external.value }) : null,
  ].filter(Boolean).join(' · '))
  const studioUrl = useStudioUrl()
  const attachmentUrl = computed(() => studioUrl.api(`/targets/${props.targetId}/submodels/${props.submodelKey}/elements/${props.detail.key}/attachment`))
  /** A Blob downloads from its value. */
  const downloadUrl = computed(() => (!isFile.value && typeof element.value.value === 'string' && element.value.value
    ? `data:${contentType.value || 'application/octet-stream'};base64,${element.value.value}`
    : null))

  const dialog = ref(false)
  const file = ref<File | null>(null)
  const saving = ref(false)
  const error = ref<unknown>(null)

  async function replace () {
    if (!file.value || !props.detail.revision) {
      return
    }
    saving.value = true
    error.value = null
    try {
      const result = await api<ElementDetail>(`/targets/${props.targetId}/submodels/${props.submodelKey}/elements/${props.detail.key}/attachment`, {
        method: 'PUT',
        query: { fileName: file.value.name },
        headers: { 'If-Match': `"${props.detail.revision}"`, 'Content-Type': file.value.type || 'application/octet-stream' },
        body: file.value,
      })
      dialog.value = false
      file.value = null
      notifications.notify({ text: t('details.replaced', { name: String(element.value.idShort) }), color: 'success' })
      emit('changed', result)
    } catch (error_) {
      error.value = error_
    } finally {
      saving.value = false
    }
  }
</script>
