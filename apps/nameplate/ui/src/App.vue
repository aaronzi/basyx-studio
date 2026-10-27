<template>
  <v-app>
    <!-- Studio's card shows the view's title. Layout of the BaSyx AAS Web UI's
         Nameplate plugins in the frame of the Documents app: the product at a
         glance, then the product's facts and the manufacturer (side by side in
         a wide frame), the markings as cards that open their details, and the
         asset specific properties. -->
    <v-view-card>
      <v-progress-linear v-if="loading" />

      <v-alert v-else-if="error" class="ma-4" :text="error" type="error" />

      <!-- A marking's details, in the frame Studio shows alone over its page (openMarking). -->
      <MarkingDialog
        v-else-if="nameplate && dialogMarking"
        :client="client"
        :index="nameplate.markings.indexOf(dialogMarking)"
        :marking="dialogMarking"
        :notice="notice"
        :submodel-id="submodelId"
        @close="closeDialog"
        @dismiss="notice = null"
      />

      <div v-else-if="nameplate" class="pa-4 d-flex flex-column ga-4">
        <v-alert
          v-if="notice"
          closable
          data-test="notice"
          density="compact"
          :text="notice.text"
          :type="notice.type"
          @click:close="notice = null"
        />

        <NameplateHeader :client="client" :nameplate="nameplate" :submodel-id="submodelId" @open="openMarking">
          <!-- Where Studio shows no full-screen button of its own (details pane, another app's page). -->
          <v-btn
            v-if="ownFullscreen"
            :aria-label="t('nameplate.fullscreen')"
            data-test="nameplate-fullscreen"
            icon
            size="small"
            @click="openFullscreen"
          >
            <v-icon icon="mdi-fullscreen" />
            <v-tooltip activator="parent" location="bottom" :text="t('nameplate.fullscreen')" />
          </v-btn>
        </NameplateHeader>

        <v-row dense>
          <v-col v-if="product.length > 0 || versions.length > 0" cols="12" md="6">
            <section data-test="product">
              <div class="d-flex align-center text-title-small mb-1">
                <v-icon class="me-2" icon="mdi-package-variant-closed" size="18" />
                {{ t('sections.product') }}
              </div>

              <div v-if="versions.length > 0 && !canEdit" class="d-flex flex-wrap ga-2 my-2" data-test="versions">
                <v-chip
                  v-for="version in versions"
                  :key="version.key"
                  :prepend-icon="version.icon"
                  :text="version.text"
                />
              </div>

              <DetailList :rows="product" />
            </section>
          </v-col>

          <v-col v-if="manufacturer.length > 0" cols="12" md="6">
            <section data-test="manufacturer">
              <div class="d-flex align-center text-title-small mb-1">
                <v-icon class="me-2" icon="mdi-factory" size="18" />
                {{ t('sections.manufacturer') }}
                <v-spacer />

                <v-btn
                  v-if="nameplate.contact && !canEdit"
                  data-test="save-vcard"
                  prepend-icon="mdi-card-account-details-outline"
                  size="small"
                  :text="t('contact.save')"
                  @click="saveVCard"
                />
              </div>

              <DetailList :rows="manufacturer" />
            </section>
          </v-col>
        </v-row>

        <section v-if="nameplate.markings.length > 0" data-test="markings">
          <div class="d-flex align-center text-title-small mb-2">
            <v-icon class="me-2" icon="mdi-check-decagram-outline" size="18" />
            {{ t('sections.markings') }}
          </div>

          <MarkingList :client="client" :markings="nameplate.markings" :submodel-id="submodelId" @open="openMarking" />
        </section>

        <AssetProperties v-model:open="propertiesOpen" :groups="groups" />
      </div>
    </v-view-card>
  </v-app>
</template>

<script lang="ts" setup>
  import type { FileRef, Marking, Nameplate } from './nameplate'
  import type { AppContext, StudioClient } from '@basyx/studio-sdk'
  import { provideFileViewer } from '@basyx/file-viewer/vue'
  import { fieldText, loadSubmodel } from '@basyx/studio-app-kit'
  import { contactVCard, vCardFileName } from '@basyx/studio-app-kit/contacts'
  import { StudioError } from '@basyx/studio-sdk'
  import { computed, onMounted, ref, shallowRef, watch } from 'vue'
  import { provideRowActions } from './actions'
  import AssetProperties from './AssetProperties.vue'
  import DetailList from './DetailList.vue'
  import { useFieldEditor } from './fieldEditor'
  import { provideI18n } from './i18n'
  import MarkingDialog from './MarkingDialog.vue'
  import MarkingList from './MarkingList.vue'
  import { parseNameplate } from './nameplate'
  import NameplateHeader from './NameplateHeader.vue'
  import { manufacturerRows, productRows, propertyGroups, versionChips } from './presentation'

  // The Digital Nameplate of an asset (IDTA 02006 3.0 and 2.0, ZVEI 1.0). In
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
  const nameplate = shallowRef<Nameplate | null>(null)
  const propertiesOpen = ref(false)

  const product = computed(() => (nameplate.value ? productRows(t, nameplate.value, formatLocale.value, canEdit.value) : []))
  const versions = computed(() => (nameplate.value ? versionChips(t, nameplate.value, formatLocale.value) : []))
  const manufacturer = computed(() => (nameplate.value ? manufacturerRows(t, nameplate.value, formatLocale.value, canEdit.value) : []))
  const groups = computed(() => (nameplate.value ? propertyGroups(t, nameplate.value.assetSpecificProperties, formatLocale.value, canEdit.value) : []))

  function fail (error_: unknown) {
    notice.value = { type: 'error', text: error_ instanceof StudioError ? error_.message : String(error_) }
  }

  async function load () {
    try {
      nameplate.value = parseNameplate(await loadSubmodel(props.client))
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
    // The frame opens no windows: Studio opens https in the browser, mailto: and tel: in the mail or phone app.
    open: url => void props.client.ui.openExternal(url).catch(fail),
    copy: text => void props.client.ui.copyText(text).then(() => props.client.ui.notify(t('contact.copied'), 'success')).catch(fail),
    preview: (file: FileRef) => void props.client.ui.previewFile(submodelId.value, file.path).catch(fail),
  })

  /** The manufacturer's contact as vCard, with the manufacturer as organization; Studio saves the file. */
  function saveVCard () {
    const value = nameplate.value
    if (!value?.contact) {
      return
    }
    const organization = fieldText(value.fields.manufacturerName, formatLocale.value)
    void props.client.ui.saveFile(vCardFileName(value.contact, formatLocale.value, organization || 'manufacturer'), contactVCard(value.contact, formatLocale.value, { organization }), 'text/vcard').catch(fail)
  }

  // Full screen opens with the asset specific properties as they are (`context.viewState`):
  // Studio's button with the reported state, the app's own where Studio has none.
  const viewState = computed(() => JSON.stringify({ properties: propertiesOpen.value }))
  watch(viewState, state => void props.client.ui.setViewState(state))

  function openFullscreen () {
    void props.client.ui.openFullscreen(viewState.value)
  }

  /** The marking whose details this frame shows as a dialog; `null` for the view. */
  const dialogPath = ref<string | null>(null)
  const dialogMarking = computed(() => nameplate.value?.markings.find(marking => marking.path === dialogPath.value) ?? null)

  /**
   * A marking's details in a dialog: the view again, alone over Studio's
   * dimmed page (openFullscreen without header), so the dialog has the
   * window wherever the view is, also in a short Overview card.
   */
  function openMarking (marking: Marking) {
    void props.client.ui.openFullscreen(JSON.stringify({ marking: marking.path }), { header: false })
  }

  function closeDialog () {
    void props.client.ui.closeFullscreen()
  }

  function restore (state: string) {
    try {
      const parsed = JSON.parse(state) as { properties?: unknown, marking?: unknown }
      propertiesOpen.value = parsed.properties === true
      dialogPath.value = context.value.fullscreen && typeof parsed.marking === 'string' ? parsed.marking : null
    } catch {
      // Not ours, or empty: the view, collapsed.
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
