import type { StudioClient } from '@basyx/studio-sdk'
import { connect } from '@basyx/studio-sdk'
import { createApp } from 'vue'
import { VAlert } from 'vuetify/components/VAlert'
import { VApp } from 'vuetify/components/VApp'
import { VBtn } from 'vuetify/components/VBtn'
import { VCard, VCardText } from 'vuetify/components/VCard'
import { VChip } from 'vuetify/components/VChip'
import { VFileInput } from 'vuetify/components/VFileInput'
import { VImg } from 'vuetify/components/VImg'
import { VList, VListItem } from 'vuetify/components/VList'
import { VMain } from 'vuetify/components/VMain'
import { VProgressLinear } from 'vuetify/components/VProgressLinear'
import { VSelect } from 'vuetify/components/VSelect'
import { VTextField } from 'vuetify/components/VTextField'
import { createAppVuetify, followStudioTheme } from '../../../shared/vuetify'
import App from './App.vue'

// In Studio's frame, the client of the bridge; in `pnpm dev`, a test Studio
// whose work-order service is in memory (@basyx/studio-sdk/testing).
const client: StudioClient = import.meta.env.DEV && window.parent === window
  ? (await import('./dev-studio')).createDevStudio().client
  : await connect()
const vuetify = createAppVuetify({ VAlert, VApp, VBtn, VCard, VCardText, VChip, VFileInput, VImg, VList, VListItem, VMain, VProgressLinear, VSelect, VTextField })
followStudioTheme(vuetify, client)
createApp(App, { client }).use(vuetify).mount('#app')
