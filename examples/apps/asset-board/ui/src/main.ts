import type { StudioClient } from '@basyx/studio-sdk'
import { connect } from '@basyx/studio-sdk'
import { createApp } from 'vue'
import { VAlert } from 'vuetify/components/VAlert'
import { VApp } from 'vuetify/components/VApp'
import { VBtn } from 'vuetify/components/VBtn'
import { VCard } from 'vuetify/components/VCard'
import { VChip } from 'vuetify/components/VChip'
import { VList, VListItem } from 'vuetify/components/VList'
import { VMain } from 'vuetify/components/VMain'
import { VProgressLinear } from 'vuetify/components/VProgressLinear'
import { createAppVuetify, followStudioTheme } from '../../../shared/vuetify'
import App from './App.vue'

// In Studio's frame, the client of the bridge; in `pnpm dev`, a test Studio
// with a few shells and settings (@basyx/studio-sdk/testing).
const client: StudioClient = import.meta.env.DEV && window.parent === window
  ? (await import('./dev-studio')).createDevStudio().client
  : await connect()
const vuetify = createAppVuetify({ VAlert, VApp, VBtn, VCard, VChip, VList, VListItem, VMain, VProgressLinear })
followStudioTheme(vuetify, client)
createApp(App, { client }).use(vuetify).mount('#app')
