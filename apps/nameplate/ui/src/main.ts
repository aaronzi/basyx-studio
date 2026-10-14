import { VAlert } from 'vuetify/components/VAlert'
import { VApp } from 'vuetify/components/VApp'
import { VCard, VCardItem, VCardSubtitle, VCardTitle } from 'vuetify/components/VCard'
import { VChip } from 'vuetify/components/VChip'
import { VDivider } from 'vuetify/components/VDivider'
import { VCol, VRow } from 'vuetify/components/VGrid'
import { VListItem } from 'vuetify/components/VList'
import { VProgressLinear } from 'vuetify/components/VProgressLinear'
import { mountApp } from '../../../shared/app'
import App from './App.vue'

await mountApp(App, { VAlert, VApp, VCard, VCardItem, VCardSubtitle, VCardTitle, VChip, VCol, VDivider, VListItem, VProgressLinear, VRow })
