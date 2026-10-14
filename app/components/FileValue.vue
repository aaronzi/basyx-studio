<template>
  <v-card border="0" color="surface-light">
    <v-list-item class="py-3" :subtitle="String(element.contentType ?? '')" :title="fileName || t('details.noFile')">
      <template #prepend>
        <v-avatar :color="isPdf ? 'error' : 'primary'" variant="tonal">
          <v-icon :icon="isImage ? 'mdi-file-image-outline' : (isPdf ? 'mdi-file-pdf-box' : 'mdi-file-outline')" />
        </v-avatar>
      </template>
    </v-list-item>

    <v-img v-if="isImage && fileName" class="mx-4 mb-2" max-height="200" :src="url" />

    <v-card-actions v-if="fileName">
      <v-btn :href="url" prepend-icon="mdi-eye-outline" target="_blank" :text="t('details.preview')" />
      <v-btn color="primary" :href="`${url}?download`" prepend-icon="mdi-download" :text="t('details.download')" />
      <v-spacer />
      <v-btn v-if="canReplace" prepend-icon="mdi-upload" :text="t('details.replace')" @click="dialog = true" />
    </v-card-actions>

    <v-card-actions v-else-if="canReplace">
      <v-spacer />
      <v-btn prepend-icon="mdi-upload" :text="t('details.replace')" @click="dialog = true" />
    </v-card-actions>

    <v-dialog v-model="dialog" max-width="480">
      <DialogCard prepend-icon="mdi-upload" :title="t('details.replaceTitle', { name: element.idShort })">
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
  import { apiBasePath } from '#shared/contract'

  const props = defineProps<{ targetId: string, submodelKey: string, detail: ElementDetail, canReplace: boolean }>()
  const emit = defineEmits<{ changed: [detail: ElementDetail] }>()

  const { t } = useI18n()
  const api = useStudioApi()
  const notifications = useNotificationsStore()

  const element = computed(() => props.detail.value as Record<string, unknown>)
  const fileName = computed(() => typeof element.value.value === 'string' ? element.value.value.split('/').pop() ?? '' : '')
  const contentType = computed(() => String(element.value.contentType ?? ''))
  const isImage = computed(() => contentType.value.startsWith('image/') && contentType.value !== 'image/svg+xml')
  const isPdf = computed(() => contentType.value === 'application/pdf')
  const url = computed(() => `${apiBasePath}/targets/${props.targetId}/submodels/${props.submodelKey}/elements/${props.detail.key}/attachment`)

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
