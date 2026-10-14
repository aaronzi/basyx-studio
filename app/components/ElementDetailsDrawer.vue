<template>
  <!-- Selecting an element changes the URL; that must not close the drawer. -->
  <v-navigation-drawer
    v-model="ui.detailsDrawer"
    border="s"
    disable-route-watcher
    location="end"
    :temporary="!xlAndUp"
    :width="smAndUp ? 440 : 360"
  >
    <template v-if="item">
      <v-toolbar color="transparent" density="compact">
        <v-breadcrumbs class="text-label-medium ps-4" density="compact" :items="crumbs">
          <template #divider>
            <v-icon icon="mdi-chevron-right" size="small" />
          </template>
        </v-breadcrumbs>

        <v-spacer />
        <v-btn :aria-label="t('common.close')" icon="mdi-close" size="small" @click="ui.detailsDrawer = false" />
      </v-toolbar>

      <v-card-item class="pt-2">
        <template #prepend>
          <v-avatar color="primary" size="48" variant="tonal">
            <v-icon :icon="modelTypeIcon(item.modelType)" />
          </v-avatar>
        </template>

        <v-card-title class="text-title-large">{{ item.variableGroup ? t(`variables.${item.variableGroup}`) : item.title }}</v-card-title>
        <v-card-subtitle>{{ item.modelType }}</v-card-subtitle>

        <template v-if="path" #append>
          <v-btn
            v-tooltip="t('details.copyPath')"
            :aria-label="t('details.copyPath')"
            icon="mdi-link-variant"
            size="small"
            @click="copy(path, t('details.path'))"
          />
        </template>
      </v-card-item>

      <ProblemAlert
        v-if="details.error.value"
        class="mx-4 mb-4"
        :error="details.error.value"
        retry
        @retry="details.refetch()"
      />

      <v-skeleton-loader v-else-if="details.isLoading.value" type="card" />

      <template v-else-if="detail">
        <div v-if="item.elementKey" class="px-4 pb-4">
          <ElementValueView
            :can-invoke="canInvoke"
            :can-replace="canWrite && capabilities.files"
            :detail="detail"
            :editable="canWrite && isEditableModelType(value.modelType) && detail.revision !== null"
            :explicit-save="capabilities.persistence === 'explicit_save'"
            :history="history"
            :item="item"
            :refreshing="refreshing"
            :submodel-key="item.submodelKey"
            :target-id="targetId"
            @changed="onChanged"
            @select="id => emit('select', id)"
          />
        </div>

        <v-divider />

        <v-list class="px-2" lines="two">
          <v-list-subheader :title="t('details.metadata')" />

          <v-list-item
            v-for="row in metadata"
            :key="row.label"
            :prepend-icon="row.icon"
            :subtitle="row.label"
            :title="row.value"
          >
            <template v-if="row.copy" #append>
              <v-btn :aria-label="t('common.copy')" icon="mdi-content-copy" size="x-small" @click="copy(row.value, row.label)" />
            </template>
          </v-list-item>
        </v-list>

        <v-divider />

        <v-expansion-panels :model-value="['description']" multiple>
          <v-expansion-panel :title="t('details.description')" value="description">
            <v-expansion-panel-text class="text-body-medium text-medium-emphasis">
              {{ description ?? t('details.noDescription') }}
            </v-expansion-panel-text>
          </v-expansion-panel>

          <v-expansion-panel :title="t('details.qualifiers')" value="qualifiers">
            <v-expansion-panel-text>
              <v-chip-group v-if="qualifiers.length > 0" column>
                <v-chip v-for="qualifier in qualifiers" :key="qualifier" prepend-icon="mdi-tag-outline" :text="qualifier" />
              </v-chip-group>

              <span v-else class="text-body-medium text-medium-emphasis">{{ t('details.noQualifiers') }}</span>
            </v-expansion-panel-text>
          </v-expansion-panel>

          <v-expansion-panel :title="t('details.rawJson')" value="json">
            <v-expansion-panel-text>
              <v-code class="text-body-small text-pre overflow-auto" tag="pre">{{ JSON.stringify(value, null, 2) }}</v-code>
            </v-expansion-panel-text>
          </v-expansion-panel>
        </v-expansion-panels>
      </template>
    </template>

    <v-empty-state
      v-else
      icon="mdi-cursor-default-click-outline"
      size="64"
      :text="t('details.nothingText')"
      :title="t('details.nothing')"
    />
  </v-navigation-drawer>
</template>

<script lang="ts" setup>
  import type { ElementDetail, SubmodelDetail, TargetCapabilities } from '#shared/contract'
  import type { ShellTreeItem } from '~/composables/useShellTrees'
  import { useQuery, useQueryCache } from '@pinia/colada'
  import { useDisplay } from 'vuetify'
  import { decodeResourceKey, isEditableModelType, langText, modelTypeIcon } from '~/utils/aas'

  const props = defineProps<{
    targetId: string
    shellKey: string
    shellLabel: string
    submodelLabel: string | null
    item: ShellTreeItem | null
    capabilities: TargetCapabilities
    /** The user may change values and files (edit mode, rights, not a past state). */
    canWrite: boolean
    canInvoke: boolean
    /** Point in time of a historic view, or `null` for now. */
    at: string | null
    history: number[]
    refreshing: boolean
  }>()
  const emit = defineEmits<{
    select: [id: string]
    /** An element changed at its source; reload what shows it. */
    changed: [detail: ElementDetail]
  }>()

  const { t } = useI18n()
  const ui = useUiStore()
  const api = useStudioApi()
  const copy = useClipboard()
  const queryCache = useQueryCache()
  const preferences = usePreferences().preferences
  const { smAndUp, xlAndUp } = useDisplay()

  // Same key prefix as before (MVP-2/3): app writes invalidate `['targets', id, 'details']`.
  const detailsKey = () => ['targets', props.targetId, 'details', props.shellKey, props.item?.submodelKey ?? '', props.item?.elementKey ?? '', props.at ?? '']
  const details = useQuery({
    key: detailsKey,
    query: async ({ signal }) => {
      const item = props.item!
      const at = props.at ?? undefined
      if (item.elementKey) {
        return api<ElementDetail>(`/targets/${props.targetId}/submodels/${item.submodelKey}/elements/${item.elementKey}`, { query: { at }, signal })
      }
      const submodel = await api<SubmodelDetail>(`/targets/${props.targetId}/submodels/${item.submodelKey}`, { signal })
      return { key: submodel.key, path: '', value: submodel.submodel, revision: null, concurrency: null } satisfies ElementDetail
    },
    enabled: () => props.item !== null && !props.item.unavailable,
  })

  const detail = computed(() => details.data.value ?? null)
  const value = computed(() => (detail.value?.value ?? {}) as Record<string, any>)
  const path = computed(() => props.item?.elementKey ? decodeResourceKey(props.item.elementKey) : null)

  const crumbs = computed(() => [
    props.shellLabel,
    ...(props.item?.elementKey ? [props.submodelLabel ?? ''] : []),
    ...(path.value ? path.value.split('.').slice(0, -1) : []),
  ].filter(Boolean).map(title => ({ title })))

  const description = computed(() => langText(Array.isArray(value.value.description) ? value.value.description : [], preferences.value.valueLanguage))

  const qualifiers = computed(() => ((value.value.qualifiers ?? []) as Array<{ type?: string, value?: string }>)
    .map(qualifier => `${qualifier.type ?? '?'}: ${qualifier.value ?? ''}`))

  const metadata = computed(() => {
    const element = value.value
    const semanticId = (element.semanticId?.keys?.[0]?.value as string | undefined) ?? props.item?.semanticId ?? null
    const rows: Array<{ label: string, value: string, icon: string, copy?: boolean }> = []
    if (props.item?.modelType === 'Submodel') {
      rows.push({ label: t('details.identifier'), value: String(element.id ?? decodeResourceKey(props.item.submodelKey)), icon: 'mdi-identifier', copy: true })
    }
    if (semanticId) {
      rows.push({ label: t('details.semanticId'), value: semanticId, icon: 'mdi-identifier', copy: true })
    }
    if (element.valueType) {
      rows.push({ label: t('details.valueType'), value: String(element.valueType), icon: 'mdi-code-tags' })
    }
    if (element.contentType) {
      rows.push({ label: t('details.contentType'), value: String(element.contentType), icon: 'mdi-file-cog-outline' })
    }
    if (element.administration?.version) {
      rows.push({ label: t('details.version'), value: [element.administration.version, element.administration.revision].filter(Boolean).join('.'), icon: 'mdi-file-certificate-outline' })
    }
    if (props.item?.children) {
      rows.push({ label: t('details.children'), value: t('details.elements', props.item.children.length), icon: 'mdi-file-tree-outline' })
    }
    if (path.value) {
      rows.push({ label: t('details.idShortPath'), value: path.value, icon: 'mdi-map-marker-path', copy: true })
    }
    return rows
  })

  function onChanged (changed: ElementDetail) {
    queryCache.setQueryData(detailsKey(), changed)
    emit('changed', changed)
  }
</script>
