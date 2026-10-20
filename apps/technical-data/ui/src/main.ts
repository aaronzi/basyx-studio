import { mountApp } from '@basyx/studio-app-kit'
import { VAlert } from 'vuetify/components/VAlert'
import { VApp } from 'vuetify/components/VApp'
import { VCard, VCardItem, VCardSubtitle, VCardText, VCardTitle } from 'vuetify/components/VCard'
import { VProgressLinear } from 'vuetify/components/VProgressLinear'
import { VTable } from 'vuetify/components/VTable'
import App from './App.vue'

await mountApp(App, { VAlert, VApp, VCard, VCardItem, VCardSubtitle, VCardText, VCardTitle, VProgressLinear, VTable })
