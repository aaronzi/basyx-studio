<template>
  <v-app>
    <!-- Studio's card shows the view's title. The sections of the BaSyx AAS Web
         UI's Technical Data plugins in the frame of the Nameplate app: the
         product at a glance, its images, general information and classes, the
         technical properties as data sheets with units, specific descriptions
         and further information. -->
    <v-view-card>
      <v-progress-linear v-if="loading" />

      <v-alert v-else-if="error" class="ma-4" :text="error" type="error" />

      <div v-else-if="data" class="pa-4 d-flex flex-column ga-4">
        <v-alert
          v-if="notice"
          closable
          data-test="notice"
          density="compact"
          :text="notice.text"
          :type="notice.type"
          @click:close="notice = null"
        />

        <TechnicalDataHeader :client="client" :data="data" :submodel-id="submodelId" @area="showArea">
          <!-- Where Studio shows no full-screen button of its own (details pane, another app's page). -->
          <v-btn
            v-if="ownFullscreen"
            :aria-label="t('technicalData.fullscreen')"
            data-test="technical-data-fullscreen"
            icon
            size="small"
            @click="openFullscreen"
          >
            <v-icon icon="mdi-fullscreen" />
            <v-tooltip activator="parent" location="bottom" :text="t('technicalData.fullscreen')" />
          </v-btn>
        </TechnicalDataHeader>

        <ProductImages v-if="data.images.length > 0" :client="client" :images="data.images" :submodel-id="submodelId" />

        <v-row v-if="general.length > 0 || data.classifications.length > 0" dense>
          <v-col v-if="general.length > 0" cols="12" :md="data.classifications.length > 0 ? 5 : 12">
            <SectionCard data-test="general" icon="mdi-information-outline" :title="t('sections.general')">
              <DetailList :rows="general" />
            </SectionCard>
          </v-col>

          <v-col v-if="data.classifications.length > 0" cols="12" :md="general.length > 0 ? 7 : 12">
            <SectionCard data-test="product-classifications" icon="mdi-shape-outline" :title="t('sections.classifications')">
              <template v-if="canEdit">
                <div v-for="(classification, index) in data.classifications" :key="classification.path">
                  <v-divider v-if="index > 0" />
                  <DetailList :rows="classificationRows(t, classification, formatLocale)" />
                </div>
              </template>

              <ClassificationTable v-else :areas="areaLinks" :classifications="data.classifications" @area="showArea" />
            </SectionCard>
          </v-col>
        </v-row>

        <section v-if="sheets.length > 0" data-test="technical-properties">
          <div class="d-flex flex-wrap align-center ga-2 mb-2">
            <v-icon icon="mdi-table-large" size="18" />

            <h3 class="text-title-small flex-grow-1">{{ t('sections.properties') }}</h3>

            <!-- Over every data sheet, the specific descriptions too. -->
            <v-text-field
              v-model="query"
              :aria-label="t('sheet.search')"
              clearable
              data-test="sheet-search"
              hide-details
              max-width="320"
              :placeholder="t('sheet.search')"
              prepend-inner-icon="mdi-magnify"
            />
          </div>

          <div v-if="query" class="text-body-small text-medium-emphasis mb-2" data-test="sheet-matches">
            {{ t('sheet.matches', { count: matches, total: totalValues }) }}
          </div>

          <v-alert
            v-if="query && matches === 0"
            data-test="sheet-no-matches"
            density="compact"
            :text="t('sheet.noMatches', { query })"
            type="info"
          />

          <div class="d-flex flex-column ga-4">
            <template v-for="sheet in sheets" :key="sheet.path">
              <div v-if="sheet.rows.length > 0" :id="anchor(sheet.path)" data-test="property-area">
                <SectionCard
                  :icon="sheet.specific ? 'mdi-text-box-outline' : 'mdi-table'"
                  :title="sheet.title"
                >
                  <DataSheet :rows="sheet.rows" />
                </SectionCard>
              </div>
            </template>
          </div>
        </section>

        <SectionCard v-if="further.length > 0" data-test="further-information" icon="mdi-text-long" :title="t('sections.further')">
          <DetailList :rows="further" />
        </SectionCard>

        <div v-if="empty" class="text-medium-emphasis" data-test="empty">{{ t('technicalData.empty') }}</div>
      </div>
    </v-view-card>
  </v-app>
</template>

<script lang="ts" setup>
  import type { Concepts } from './presentation'
  import type { TechnicalData } from './technicalData'
  import type { FileRef } from '@basyx/studio-app-kit/aas'
  import type { AppContext, ConceptInfo, StudioClient } from '@basyx/studio-sdk'
  import { provideFileViewer } from '@basyx/file-viewer/vue'
  import { loadSubmodel } from '@basyx/studio-app-kit'
  import { provideRowActions, useFieldEditor } from '@basyx/studio-app-kit/editing'
  import { describeConceptsMaxIds, StudioError } from '@basyx/studio-sdk'
  import { computed, nextTick, onMounted, ref, shallowRef, watch } from 'vue'
  import ClassificationTable from './ClassificationTable.vue'
  import DataSheet from './DataSheet.vue'
  import DetailList from './DetailList.vue'
  import { provideI18n } from './i18n'
  import { areaTitle, classificationRows, conceptMap, conceptQuery, filterRows, furtherRows, generalRows, sheetRows } from './presentation'
  import ProductImages from './ProductImages.vue'
  import SectionCard from './SectionCard.vue'
  import { parseTechnicalData, sheetConceptIds } from './technicalData'
  import TechnicalDataHeader from './TechnicalDataHeader.vue'

  // The technical data of an asset (IDTA 02003 2.0, ZVEI 1.2 and 1.1). In
  // Studio's edit mode, its values can be changed where the target and the
  // user's rights allow it.
  const props = defineProps<{ client: StudioClient }>()

  const { t, locale, formatLocale } = provideI18n(props.client)
  provideFileViewer({ locale: () => locale.value })

  const context = ref<AppContext>(props.client.context)
  props.client.onContext(value => {
    context.value = value
  })
  const submodelId = computed(() => context.value.submodel!.id)
  const ownFullscreen = computed(() => !context.value.fullscreen && !context.value.fullscreenControl)
  const canEdit = computed(() => (context.value.target?.write ?? false) && context.value.mode === 'edit' && !context.value.embedded)

  const loading = ref(true)
  const error = ref<string | null>(null)
  const notice = ref<{ type: 'success' | 'error', text: string } | null>(null)
  const data = shallowRef<TechnicalData | null>(null)
  /** The concept descriptions found so far, by ID; asked for once each. */
  const concepts = shallowRef<Concepts>(new Map())
  const asked = new Set<string>()
  const query = ref('')

  const general = computed(() => (data.value ? generalRows(t, data.value, formatLocale.value, canEdit.value) : []))
  const further = computed(() => (data.value ? furtherRows(t, data.value, formatLocale.value, canEdit.value) : []))

  /** Every data sheet: the areas of technical properties, then the specific descriptions. */
  const allSheets = computed(() => {
    const value = data.value
    if (!value) {
      return []
    }
    const areas = [...value.areas.map(area => ({ area, specific: false })), ...value.specificDescriptions.map(area => ({ area, specific: true }))]
    return areas.map(({ area, specific }, index) => ({
      path: area.path,
      specific,
      title: specific && value.specificDescriptions.length === 1 && area.displayName.length === 0
        ? t('sections.specificDescriptions')
        : areaTitle(t, area, specific ? index - value.areas.length : index, concepts.value, formatLocale.value),
      rows: sheetRows(t, area, concepts.value, formatLocale.value, canEdit.value),
    }))
  })
  const sheets = computed(() => allSheets.value
    .map(sheet => ({ ...sheet, rows: filterRows(sheet.rows, query.value ?? '') }))
    .filter(sheet => sheet.rows.length > 0 || !query.value))
  const totalValues = computed(() => allSheets.value.reduce((sum, sheet) => sum + sheet.rows.filter(row => row.kind === 'value').length, 0))
  const matches = computed(() => sheets.value.reduce((sum, sheet) => sum + sheet.rows.filter(row => row.kind === 'value').length, 0))
  const areaLinks = computed(() => allSheets.value.filter(sheet => !sheet.specific).map(sheet => ({ path: sheet.path, title: sheet.title })))
  const empty = computed(() => data.value !== null && general.value.length === 0 && data.value.classifications.length === 0
    && data.value.images.length === 0 && allSheets.value.every(sheet => sheet.rows.length === 0) && further.value.length === 0)

  function fail (error_: unknown) {
    notice.value = { type: 'error', text: error_ instanceof StudioError ? error_.message : String(error_) }
  }

  /** Units, names and definitions of the elements not asked for yet; without them, the sheets show idShorts and no units. */
  async function describe (value: TechnicalData) {
    const ids = conceptQuery(sheetConceptIds(value)).filter(id => !asked.has(id))
    if (ids.length === 0) {
      return
    }
    for (const id of ids) {
      asked.add(id)
    }
    const found = new Map(concepts.value)
    for (let start = 0; start < ids.length; start += describeConceptsMaxIds) {
      try {
        const { concepts: answer } = await props.client.aas.describeConcepts(ids.slice(start, start + describeConceptsMaxIds))
        for (const [id, concept] of conceptMap(answer as Array<ConceptInfo | null>)) {
          found.set(id, concept)
        }
      } catch {
        // A target whose concept descriptions cannot be read: the data sheets as they are.
      }
    }
    concepts.value = found
  }

  async function load () {
    try {
      const value = parseTechnicalData(await loadSubmodel(props.client))
      await describe(value)
      data.value = value
      error.value = null
    } catch (error_) {
      error.value = error_ instanceof StudioError ? error_.message : String(error_)
    } finally {
      loading.value = false
    }
  }

  const editor = useFieldEditor({
    client: props.client,
    t,
    locale: () => formatLocale.value,
    submodelId: () => submodelId.value,
    onSaved: async label => {
      notice.value = { type: 'success', text: t('edit.saved', { label }) }
      await props.client.ui.notify(t('edit.saved', { label }), 'success')
      await load()
    },
  })
  watch(editor.error, value => {
    if (value) {
      notice.value = { type: 'error', text: value }
    }
  })
  watch(canEdit, value => {
    if (!value) {
      editor.cancel()
    }
  })

  provideRowActions({
    canEdit,
    editor,
    // The frame opens no windows: Studio opens https in the browser.
    open: url => void props.client.ui.openExternal(url).catch(fail),
    copy: text => void props.client.ui.copyText(text).then(() => props.client.ui.notify(t('copy.copied'), 'success')).catch(fail),
    preview: (file: FileRef) => void props.client.ui.previewFile(submodelId.value, file.path).catch(fail),
  })

  /** The id of an area's data sheet in the page. */
  function anchor (path: string): string {
    return `area-${path.replaceAll(/[^\w-]/g, '-')}`
  }

  /** Scrolls to the data sheet of an area, e.g. the one a classification refers to; the search is cleared if it hides it. */
  async function showArea (path: string) {
    if (!sheets.value.some(sheet => sheet.path === path && sheet.rows.length > 0)) {
      query.value = ''
      await nextTick()
    }
    document.querySelector(`#${anchor(path)}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  // Full screen opens with the search as it is (`context.viewState`):
  // Studio's button with the reported state, the app's own where Studio has none.
  const viewState = computed(() => JSON.stringify({ query: query.value ?? '' }))
  watch(viewState, state => void props.client.ui.setViewState(state))

  function openFullscreen () {
    void props.client.ui.openFullscreen(viewState.value)
  }

  function restore (state: string) {
    try {
      const parsed = JSON.parse(state) as { query?: unknown }
      query.value = typeof parsed.query === 'string' ? parsed.query : ''
    } catch {
      // Not ours, or empty: without a search.
    }
  }

  // A full-screen dialog may have changed values: read them again when it closes.
  watch(() => context.value.fullscreenOpen, (open, before) => {
    if (before && !open) {
      void load()
    }
  })

  onMounted(async () => {
    restore(context.value.viewState ?? '')
    await load()
  })
</script>
