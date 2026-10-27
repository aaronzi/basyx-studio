import { mountApp } from '@basyx/studio-app-kit'
import { VAlert } from 'vuetify/components/VAlert'
import { VApp } from 'vuetify/components/VApp'
import { VAvatar } from 'vuetify/components/VAvatar'
import { VBtn } from 'vuetify/components/VBtn'
import { VCard, VCardActions, VCardItem, VCardSubtitle, VCardText, VCardTitle } from 'vuetify/components/VCard'
import { VChip } from 'vuetify/components/VChip'
import { VDialog } from 'vuetify/components/VDialog'
import { VDivider } from 'vuetify/components/VDivider'
import { VCol, VRow, VSpacer } from 'vuetify/components/VGrid'
import { VIcon } from 'vuetify/components/VIcon'
import { VProgressLinear } from 'vuetify/components/VProgressLinear'
import { VTable } from 'vuetify/components/VTable'
import { VTextField } from 'vuetify/components/VTextField'
import { VTooltip } from 'vuetify/components/VTooltip'
import App from './App.vue'

await mountApp(App, {
  VAlert,
  VApp,
  VAvatar,
  VBtn,
  VCard,
  VCardActions,
  VCardItem,
  VCardSubtitle,
  VCardText,
  VCardTitle,
  VChip,
  VCol,
  VDialog,
  VDivider,
  VIcon,
  VProgressLinear,
  VRow,
  VSpacer,
  VTable,
  VTextField,
  VTooltip,
})
