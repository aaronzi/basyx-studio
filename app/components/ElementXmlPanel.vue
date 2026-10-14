<template>
  <div class="d-flex flex-column h-100">
    <v-toolbar color="transparent" density="compact">
      <v-toolbar-title class="text-body-medium text-medium-emphasis">{{ t('details.modes.xmlLabel') }}</v-toolbar-title>

      <template #append>
        <v-btn
          :aria-label="t('common.copy')"
          :disabled="!xml.data.value"
          icon="mdi-content-copy"
          size="small"
          @click="copy(xml.data.value ?? '', t('details.modes.xml'))"
        />

        <v-btn
          :aria-label="t('details.download')"
          :disabled="!xml.data.value"
          icon="mdi-download"
          size="small"
          @click="download"
        />
      </template>
    </v-toolbar>

    <v-divider />

    <ProblemAlert
      v-if="xml.error.value"
      class="ma-4"
      :error="xml.error.value"
      retry
      @retry="xml.refetch()"
    />

    <v-skeleton-loader v-else-if="xml.isLoading.value" type="paragraph@3" />

    <v-code v-else class="flex-grow-1 overflow-auto text-mono text-pre text-body-small pa-4" rounded="0" tag="pre">{{ xml.data.value }}</v-code>
  </div>
</template>

<script lang="ts" setup>
  import { useQuery } from '@pinia/colada'

  // The AAS XML serialization of the selected submodel or element (MVP-4 plan, T2).
  const props = defineProps<{ targetId: string, submodelKey: string, elementKey: string | null, at: string | null, fileName: string }>()

  const { t } = useI18n()
  const api = useStudioApi()
  const copy = useClipboard()

  const xml = useQuery({
    key: () => ['targets', props.targetId, 'details', 'xml', props.submodelKey, props.elementKey ?? '', props.at ?? ''],
    query: async ({ signal }) => {
      const path = props.elementKey
        ? `/targets/${props.targetId}/submodels/${props.submodelKey}/elements/${props.elementKey}`
        : `/targets/${props.targetId}/submodels/${props.submodelKey}`
      const blob = await api<Blob>(path, { query: { format: 'xml', at: props.at ?? undefined }, responseType: 'blob', signal })
      return blob.text()
    },
  })

  function download () {
    const url = URL.createObjectURL(new Blob([xml.data.value ?? ''], { type: 'application/xml' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `${props.fileName}.xml`
    link.click()
    URL.revokeObjectURL(url)
  }
</script>
