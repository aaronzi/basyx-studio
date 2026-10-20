import { mountApp } from '@basyx/studio-app-kit'
import { VAlert } from 'vuetify/components/VAlert'
import { VApp } from 'vuetify/components/VApp'
import { VCardItem, VCardSubtitle, VCardText, VCardTitle } from 'vuetify/components/VCard'
import { VCode } from 'vuetify/components/VCode'
import { VCol, VRow, VSpacer } from 'vuetify/components/VGrid'
import { VIcon } from 'vuetify/components/VIcon'
import { VImg } from 'vuetify/components/VImg'
import { VList, VListItem } from 'vuetify/components/VList'
import { VProgressLinear } from 'vuetify/components/VProgressLinear'
import { VSelect } from 'vuetify/components/VSelect'
import { VSheet } from 'vuetify/components/VSheet'
import { VTextField } from 'vuetify/components/VTextField'
import { VTreeview } from 'vuetify/components/VTreeview'
import App from './App.vue'

await mountApp(App, {
  VAlert,
  VApp,
  VCardItem,
  VCardSubtitle,
  VCardText,
  VCardTitle,
  VCode,
  VCol,
  VIcon,
  VImg,
  VList,
  VListItem,
  VProgressLinear,
  VRow,
  VSelect,
  VSheet,
  VSpacer,
  VTextField,
  VTreeview,
})
