<template>
  <v-app>
    <!-- Studio's card shows the view's title. Layout of the BaSyx AAS Web UI's
         HandoverDocumentation plugins in the frame of the 3D Models app: the
         documents, the selected one's file (side by side in a wide frame),
         its facts, then the technical details. -->
    <v-view-card>
      <v-progress-linear v-if="loading" />

      <v-alert v-else-if="error" class="ma-4" :text="error" type="error" />

      <v-card-text v-else-if="documents.length === 0" class="text-medium-emphasis" data-test="no-documents">{{ t('document.none') }}</v-card-text>

      <div v-else class="pa-4">
        <v-alert
          v-if="actionError"
          class="mb-4"
          closable
          density="compact"
          :text="actionError"
          type="error"
          @click:close="actionError = null"
        />

        <v-row dense>
          <v-col cols="12" :md="fullscreen ? 3 : 4">
            <DocumentList
              v-model:classes="classes"
              v-model:query="query"
              :client="client"
              :documents="filtered"
              :options="classOptions"
              :searchable="documents.length > 5"
              :selected-key="selected?.key ?? ''"
              :submodel-id="submodelId"
              :title-of="listTitle"
              :total="documents.length"
              @select="key => (selectedKey = key)"
            />
          </v-col>

          <v-col cols="12" :md="fullscreen ? 9 : 8">
            <div v-if="selected" class="d-flex flex-column ga-4">
              <div>
                <div class="d-flex flex-wrap align-center ga-2">
                  <span class="text-title-small text-break" data-test="document-title">{{ title }}</span>

                  <v-chip
                    v-if="version?.status"
                    :color="statusColor(version.status)"
                    data-test="document-status"
                    size="x-small"
                    :text="statusText(t, version.status)"
                  />

                  <v-spacer />
                  <VersionMenu :selected="version" :versions="selected.versions" @select="key => (versionKeys[selected!.key] = key)" />

                  <v-btn
                    v-if="!fullscreen"
                    :aria-label="t('document.fullscreen')"
                    data-test="document-fullscreen"
                    icon
                    size="small"
                    @click="openFullscreen"
                  >
                    <v-icon icon="mdi-fullscreen" />
                    <v-tooltip activator="parent" location="bottom" :text="t('document.fullscreen')" />
                  </v-btn>
                </div>

                <div v-if="subtitle" class="text-body-medium text-medium-emphasis">{{ subtitle }}</div>
              </div>

              <DocumentPreview
                :key="version?.key ?? selected.key"
                v-model:file="fileKeys[version?.key ?? selected.key]"
                :client="client"
                :fullscreen="fullscreen"
                :submodel-id="submodelId"
                :version="version"
                @error="message => (actionError = message)"
              />

              <DocumentSummary :version="version" />

              <TechnicalDetails :groups="groups" @open="open" />
            </div>
          </v-col>
        </v-row>
      </div>
    </v-view-card>
  </v-app>
</template>

<script lang="ts" setup>
  import type { HandoverDocument } from './handoverDocumentation'
  import type { DetailRow, ReferenceContext } from './presentation'
  import type { AppContext, StudioClient } from '@basyx/studio-sdk'
  import { provideFileViewer } from '@basyx/file-viewer/vue'
  import { loadSubmodel } from '@basyx/studio-app-kit'
  import { StudioError } from '@basyx/studio-sdk'
  import { computed, onMounted, reactive, ref, shallowRef } from 'vue'
  import DocumentList from './DocumentList.vue'
  import DocumentPreview from './DocumentPreview.vue'
  import DocumentSummary from './DocumentSummary.vue'
  import { classificationKey, latestVersion, mainClassification, matchesQuery, parseHandoverDocumentation, pickText } from './handoverDocumentation'
  import { provideI18n } from './i18n'
  import { statusColor, statusText, technicalGroups, titleText } from './presentation'
  import TechnicalDetails from './TechnicalDetails.vue'
  import VersionMenu from './VersionMenu.vue'

  // The handover documentation of an asset (IDTA 02004-2-0 and 1-2, VDI 2770).
  const props = defineProps<{ client: StudioClient }>()

  const { t, locale, formatLocale } = provideI18n(props.client)
  provideFileViewer({ locale: () => locale.value })

  const context = ref<AppContext>(props.client.context)
  props.client.onContext(value => {
    context.value = value
  })
  const submodelId = computed(() => context.value.submodel!.id)
  const fullscreen = computed(() => context.value.fullscreen)

  const loading = ref(true)
  const error = ref<string | null>(null)
  /** A file or link that did not open. */
  const actionError = ref<string | null>(null)
  const parsed = shallowRef<ReturnType<typeof parseHandoverDocumentation>>({ documents: [], entities: [] })
  const documents = computed(() => parsed.value.documents)

  /** What the full-screen view opens with: the selected document, versions, files and filter. */
  interface ViewState {
    document: string
    versions: Record<string, string>
    files: Record<string, string>
    query: string
    classes: string[]
  }

  const selectedKey = ref('')
  /** The chosen version per document; the latest otherwise. */
  const versionKeys = reactive<Record<string, string>>({})
  /** The chosen file per version; its first digital file otherwise. */
  const fileKeys = reactive<Record<string, string>>({})
  const query = ref('')
  const classes = ref<string[]>([])

  function versionOf (document: HandoverDocument) {
    return document.versions.find(entry => entry.key === versionKeys[document.key]) ?? latestVersion(document.versions)
  }

  /** A document's title in the list and in references: that of its latest version. */
  function listTitle (document: HandoverDocument): string {
    return titleText(t, document, latestVersion(document.versions), documents.value.indexOf(document), formatLocale.value)
  }

  /** The classes to filter by: each document's VDI 2770 class (else its first), in the documents' order. */
  const classOptions = computed(() => {
    const options = new Map<string, string>()
    for (const document of documents.value) {
      const classification = mainClassification(document)
      if (classification && !options.has(classificationKey(classification))) {
        options.set(classificationKey(classification), pickText(classification.name, formatLocale.value) || classification.id)
      }
    }
    return [...options].map(([value, title]) => ({ value, title }))
  })

  const filtered = computed(() => documents.value.filter(document => {
    const classification = mainClassification(document)
    return matchesQuery(document, query.value) && (classes.value.length === 0 || (classification !== undefined && classes.value.includes(classificationKey(classification))))
  }))

  const selected = computed(() => filtered.value.find(document => document.key === selectedKey.value) ?? filtered.value[0])
  const version = computed(() => (selected.value ? versionOf(selected.value) : undefined))
  const title = computed(() => (selected.value ? titleText(t, selected.value, version.value, documents.value.indexOf(selected.value), formatLocale.value) : ''))
  const subtitle = computed(() => pickText(version.value?.subtitle ?? [], formatLocale.value))

  const references = computed<ReferenceContext>(() => ({
    submodelId: submodelId.value,
    documents: documents.value,
    entities: parsed.value.entities,
    titleOf: listTitle,
  }))
  const groups = computed(() => (selected.value ? technicalGroups(t, selected.value, version.value, references.value, formatLocale.value) : []))

  function fail (error_: unknown) {
    actionError.value = error_ instanceof StudioError ? error_.message : String(error_)
  }

  /** A row's link: another document of this submodel, a shell in Studio, or an address in the browser. */
  function open (row: DetailRow) {
    if (row.document) {
      // The document may be filtered out: the filter goes.
      query.value = ''
      classes.value = []
      selectedKey.value = row.document
    } else if (row.shell) {
      void props.client.ui.openShell(row.shell).catch(fail)
    } else if (row.url) {
      void props.client.ui.openExternal(row.url).catch(() => {
        // Not https, or not from a click: nothing opens.
      })
    }
  }

  /** Full screen shows the same document, version and file (`context.viewState`). */
  function openFullscreen () {
    const state: ViewState = { document: selected.value?.key ?? '', versions: { ...versionKeys }, files: { ...fileKeys }, query: query.value, classes: classes.value }
    void props.client.ui.openFullscreen(JSON.stringify(state))
  }

  function restore (viewState: string) {
    try {
      const state = JSON.parse(viewState) as Partial<ViewState>
      selectedKey.value = typeof state.document === 'string' ? state.document : ''
      query.value = typeof state.query === 'string' ? state.query : ''
      classes.value = Array.isArray(state.classes) ? state.classes.filter(entry => typeof entry === 'string') : []
      for (const [target, values] of [[versionKeys, state.versions], [fileKeys, state.files]] as const) {
        for (const [key, value] of Object.entries(values ?? {})) {
          if (typeof value === 'string') {
            target[key] = value
          }
        }
      }
    } catch {
      // Not ours, or empty: the first document in its latest version.
    }
  }

  onMounted(async () => {
    try {
      parsed.value = parseHandoverDocumentation(await loadSubmodel(props.client))
      restore(context.value.viewState ?? '')
    } catch (error_) {
      error.value = error_ instanceof StudioError ? error_.message : String(error_)
    } finally {
      loading.value = false
    }
  })
</script>
