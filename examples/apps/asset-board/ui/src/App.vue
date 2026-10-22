<template>
  <v-app>
    <v-main>
      <div class="d-flex flex-column ga-4 pa-4">
        <!-- What the administrator set for this target (ADR 0048). -->
        <div class="d-flex flex-wrap align-center ga-2" data-test="settings">
          <v-chip v-for="type in assetTypes" :key="type" prepend-icon="mdi-shape-outline" :text="type" />
          <v-chip prepend-icon="mdi-identifier" :text="`Serial: ${serialIdName}`" />
          <v-chip prepend-icon="mdi-format-list-numbered" :text="`${pageSize} per page`" />
        </div>

        <v-alert
          v-if="assetTypes.length === 0"
          data-test="not-configured"
          text="An administrator sets the asset types of this app on the Apps page, or for this infrastructure in its dialog or the declared YAML."
          title="Not configured"
          type="info"
        />

        <template v-else>
          <v-alert v-if="error" data-test="error" :text="error" type="error" />

          <v-card :title="`Shells of these asset types (${matching.length})`">
            <v-progress-linear v-if="loading" />

            <v-list v-if="matching.length > 0" data-test="matching">
              <v-list-item
                v-for="row in matching"
                :key="row.id"
                :subtitle="`${row.assetType} · ${row.serial ?? 'no serial number'}`"
                :title="row.name"
                @click="client.ui.openShell(row.id)"
              />
            </v-list>

            <v-card-text v-else-if="!loading" class="text-medium-emphasis">No shell has one of these asset types.</v-card-text>
          </v-card>

          <v-card v-if="showOthers && others.length > 0" :title="`Other shells (${others.length})`">
            <v-list data-test="others">
              <v-list-item v-for="row in others" :key="row.id" :subtitle="row.assetType ?? 'no asset type'" :title="row.name" />
            </v-list>
          </v-card>

          <v-btn v-if="cursor" :loading="loading" text="More" @click="load(false)" />
        </template>
      </div>
    </v-main>
  </v-app>
</template>

<script lang="ts" setup>
  import type { AppContext, StudioClient } from '@basyx/studio-sdk'
  import { StudioError } from '@basyx/studio-sdk'
  import { computed, onMounted, ref, watch } from 'vue'

  interface Row { id: string, name: string, assetType: string | null, serial: string | null }

  const props = defineProps<{ client: StudioClient }>()

  // The settings follow the context: a frame on another infrastructure gets its values.
  const context = ref<AppContext>(props.client.context)
  props.client.onContext(next => {
    context.value = next
  })
  const settings = computed(() => context.value.settings ?? {})
  const assetTypes = computed(() => (settings.value.assetTypes as string[] | null) ?? [])
  const serialIdName = computed(() => (settings.value.serialIdName as string | null) ?? 'serialNumber')
  const pageSize = computed(() => (settings.value.pageSize as number | null) ?? 25)
  const showOthers = computed(() => settings.value.showOthers === true)

  const rows = ref<Row[]>([])
  const cursor = ref<string | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)

  const matching = computed(() => rows.value.filter(row => row.assetType !== null && assetTypes.value.includes(row.assetType)))
  const others = computed(() => rows.value.filter(row => !matching.value.includes(row)))

  /** Reads a page of shells; their summaries carry the asset type and specific asset IDs (Studio app API 0.1.8). */
  async function load (reset: boolean) {
    if (assetTypes.value.length === 0) {
      return
    }
    loading.value = true
    error.value = null
    try {
      const page = await props.client.aas.listShells({ limit: pageSize.value, ...(reset || !cursor.value ? {} : { cursor: cursor.value }) })
      const read = page.items.map(summary => ({
        id: summary.id,
        name: summary.displayName[0]?.text ?? summary.idShort ?? summary.id,
        assetType: summary.assetType ?? null,
        serial: summary.specificAssetIds?.find(id => id.name === serialIdName.value)?.value ?? null,
      }))
      rows.value = reset ? read : [...rows.value, ...read]
      cursor.value = page.page.hasMore ? page.page.nextCursor : null
    } catch (error_) {
      error.value = error_ instanceof StudioError ? `${error_.message} (${error_.code})` : String(error_)
    } finally {
      loading.value = false
    }
  }

  watch(() => JSON.stringify(settings.value), () => load(true))
  onMounted(() => load(true))
</script>
