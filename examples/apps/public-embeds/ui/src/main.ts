import { connect } from '@basyx/studio-sdk'
import { createApp } from 'vue'
import { VAlert } from 'vuetify/components/VAlert'
import { VApp } from 'vuetify/components/VApp'
import { VBtn } from 'vuetify/components/VBtn'
import { VBtnToggle } from 'vuetify/components/VBtnToggle'
import { VCard, VCardText } from 'vuetify/components/VCard'
import { VList, VListItem } from 'vuetify/components/VList'
import { VMain } from 'vuetify/components/VMain'
import { VProgressLinear } from 'vuetify/components/VProgressLinear'
import { VSheet } from 'vuetify/components/VSheet'
import { createAppVuetify, followStudioTheme } from '../../../shared/vuetify'
import App from './App.vue'

const client = await connect()
const vuetify = createAppVuetify({ VAlert, VApp, VBtn, VBtnToggle, VCard, VCardText, VList, VListItem, VMain, VProgressLinear, VSheet })
followStudioTheme(vuetify, client)
createApp(App, { client }).use(vuetify).mount('#app')
