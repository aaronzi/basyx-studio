<template>
  <v-app>
    <v-card>
      <v-card-item prepend-icon="mdi-card-account-details-outline">
        <v-card-title>Digital Nameplate</v-card-title>
        <v-card-subtitle>{{ version }}</v-card-subtitle>

        <template #append>
          <v-chip
            v-for="marking in markings"
            :key="marking"
            class="ms-1"
            prepend-icon="mdi-check-decagram-outline"
            :text="marking"
            variant="outlined"
          />
        </template>
      </v-card-item>

      <v-progress-linear v-if="loading" />

      <v-alert v-else-if="error" class="ma-4" :text="error" type="error" />

      <template v-else>
        <v-divider />

        <v-row no-gutters>
          <v-col v-for="row in rows" :key="row.label" cols="12" sm="6">
            <v-list-item lines="two" :prepend-icon="row.icon" :subtitle="row.label" :title="row.value || '—'" />
          </v-col>
        </v-row>
      </template>
    </v-card>
  </v-app>
</template>

<script lang="ts" setup>
  import type { JsonObject, StudioClient } from '@basyx/studio-sdk'
  import { StudioError } from '@basyx/studio-sdk'
  import { computed, onMounted, ref } from 'vue'
  import { child, childrenOf, loadSubmodel, textOf } from '../../../shared/app'

  const props = defineProps<{ client: StudioClient }>()

  const loading = ref(true)
  const error = ref<string | null>(null)
  const submodel = ref<JsonObject | null>(null)
  const locale = computed(() => props.client.context.locale)

  function text (idShort: string, parent: JsonObject | undefined = submodel.value ?? undefined) {
    return textOf(child(parent, idShort), locale.value)
  }

  /** The IDTA template version from the semantic ID, e.g. `IDTA 02006-3-0`. */
  const version = computed(() => {
    const semanticId = props.client.context.submodel?.semanticId ?? ''
    const match = /nameplate\/(\d)\/(\d)/i.exec(semanticId)
    return match ? `IDTA 02006-${match[1]}-${match[2]}` : 'IDTA 02006'
  })

  const rows = computed(() => {
    if (!submodel.value) {
      return []
    }
    const address = child(submodel.value, 'AddressInformation')?.element
    const versions = [text('HardwareVersion'), text('FirmwareVersion')].filter(Boolean).join(' / ')
    const place = [text('Zipcode', address), text('CityTown', address)].filter(Boolean).join(' ')
    return [
      { label: 'Manufacturer', value: text('ManufacturerName'), icon: 'mdi-factory' },
      { label: 'Product designation', value: text('ManufacturerProductDesignation') || text('ManufacturerProductType'), icon: 'mdi-tag-outline' },
      { label: 'Serial number', value: text('SerialNumber'), icon: 'mdi-barcode' },
      { label: 'Date of manufacture', value: text('DateOfManufacture'), icon: 'mdi-calendar-outline' },
      { label: 'Hardware / firmware', value: versions, icon: 'mdi-memory' },
      { label: 'Address', value: [text('Street', address), place].filter(Boolean).join(', '), icon: 'mdi-map-marker-outline' },
    ]
  })

  const markings = computed(() => {
    const list = child(submodel.value ?? undefined, 'Markings')
    return list ? childrenOf(list).map(marking => textOf(child(marking, 'MarkingName'), locale.value)).filter(Boolean) : []
  })

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
