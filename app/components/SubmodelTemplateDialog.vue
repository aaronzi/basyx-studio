<template>
  <v-dialog v-model="open" persistent scrollable width="640">
    <DialogCard :title="t('submodels.fromTemplateTitle')">
      <ProblemAlert
        v-if="templates.error.value"
        class="mb-3"
        :error="templates.error.value"
        retry
        @retry="templates.refetch()"
      />

      <v-autocomplete
        v-model="templateId"
        item-props
        :items="templateItems"
        :label="t('wizard.fromTemplate')"
        :loading="templates.isLoading.value"
        prepend-inner-icon="mdi-file-document-outline"
      />

      <template v-if="templateId">
        <v-text-field
          v-model="idShort"
          :hint="t('submodels.idShortHint')"
          label="idShort"
          persistent-hint
        />

        <ProblemAlert v-if="fields.error.value" class="mt-3" :error="fields.error.value" />

        <v-skeleton-loader v-else-if="fields.isLoading.value" type="list-item@3" />

        <template v-else-if="fields.data.value">
          <div class="text-title-small mt-4 mb-2">{{ t('wizard.required') }}</div>

          <v-text-field
            v-for="field in requiredInputs"
            :key="field.path"
            v-model="values[field.path]"
            :hint="field.path"
            :label="field.label"
          />

          <p v-if="requiredInputs.length === 0" class="text-body-medium text-medium-emphasis">{{ t('wizard.noRequired') }}</p>

          <template v-if="optional.length > 0">
            <div class="d-flex align-center mt-4 mb-1">
              <span class="text-title-small flex-grow-1">{{ t('wizard.optional', { count: optional.length }) }}</span>

              <v-btn-group>
                <v-btn :text="t('wizard.selectAll')" @click="include = optional.map(field => field.path)" />
                <v-btn :text="t('wizard.selectNone')" @click="include = []" />
              </v-btn-group>
            </div>

            <v-sheet
              border
              class="overflow-y-auto px-2"
              color="transparent"
              max-height="240"
              rounded="lg"
            >
              <v-checkbox
                v-for="field in optional"
                :key="field.path"
                v-model="include"
                :class="`ms-${Math.min(field.depth, 4) * 4}`"
                hide-details
                :label="field.label"
                :value="field.path"
              />
            </v-sheet>
          </template>
        </template>
      </template>

      <ProblemAlert v-if="error" class="mt-3" :error="error" />

      <template #actions>
        <v-btn :disabled="busy" :text="t('common.cancel')" @click="open = false" />
        <v-btn-primary :disabled="!templateId || !fields.data.value" :loading="busy" :text="t('wizard.create')" @click="create" />
      </template>
    </DialogCard>
  </v-dialog>
</template>

<script lang="ts" setup>
  import type { SubmodelTemplate, SubmodelTemplateFields } from '#shared/contract'
  import { useQuery } from '@pinia/colada'

  // A submodel on its own from a template (MVP-5 plan, T1-T3): the bundled
  // IDTA templates or a Template-kind submodel of the target, with the values
  // of its required elements and the optional elements to keep.
  const props = defineProps<{ targetId: string }>()
  const emit = defineEmits<{ created: [submodelKey: string] }>()
  const open = defineModel<boolean>({ required: true })

  const { t } = useI18n()
  const api = useStudioApi()

  const templateId = ref<string | null>(null)
  const idShort = ref('')
  const values = ref<Record<string, string>>({})
  const include = ref<string[]>([])
  const busy = ref(false)
  const error = ref<unknown>(null)

  const templates = useQuery({
    key: () => ['targets', props.targetId, 'templates'],
    query: ({ signal }) => api<{ items: SubmodelTemplate[] }>(`/targets/${props.targetId}/templates`, { signal }),
    enabled: () => open.value,
  })
  const templateItems = computed(() => (templates.data.value?.items ?? []).map(template => ({
    title: template.version ? `${template.title} ${template.version}` : template.title,
    subtitle: template.source === 'bundled' ? t('wizard.bundled') : t('wizard.onTarget'),
    value: template.id,
  })))

  const fields = useQuery({
    key: () => ['targets', props.targetId, 'templates', templateId.value ?? ''],
    query: ({ signal }) => api<SubmodelTemplateFields>(`/targets/${props.targetId}/templates/${encodeURIComponent(templateId.value!)}`, { signal }),
    enabled: () => templateId.value !== null,
  })
  // Files are added in the tree afterwards; their value is a path.
  const requiredInputs = computed(() => (fields.data.value?.fields ?? []).filter(field => field.required && field.input && field.modelType !== 'File'))
  const optional = computed(() => (fields.data.value?.fields ?? []).filter(field => !field.required))

  watch(templateId, () => {
    values.value = {}
    include.value = []
  })

  watch(open, value => {
    if (value) {
      templateId.value = null
      idShort.value = ''
      error.value = null
    }
  })

  async function create () {
    busy.value = true
    error.value = null
    try {
      const filled = Object.fromEntries(Object.entries(values.value).filter(([, value]) => value !== ''))
      const result = await api<{ submodelKey: string }>(`/targets/${props.targetId}/submodels`, {
        method: 'POST',
        body: { submodel: { source: 'template', templateId: templateId.value, idShort: idShort.value.trim() || undefined, include: include.value, values: filled } },
      })
      open.value = false
      emit('created', result.submodelKey)
    } catch (error_) {
      error.value = error_
    } finally {
      busy.value = false
    }
  }
</script>
