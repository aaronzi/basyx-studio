import { mountApp } from '@basyx/studio-app-kit'
import { VAlert } from 'vuetify/components/VAlert'
import { VApp } from 'vuetify/components/VApp'
import { VBtn } from 'vuetify/components/VBtn'
import { VBtnToggle } from 'vuetify/components/VBtnToggle'
import { VCard, VCardItem, VCardSubtitle, VCardText, VCardTitle } from 'vuetify/components/VCard'
import { VChip } from 'vuetify/components/VChip'
import { VChipGroup } from 'vuetify/components/VChipGroup'
import { VDivider } from 'vuetify/components/VDivider'
import { VExpansionPanel, VExpansionPanels, VExpansionPanelText } from 'vuetify/components/VExpansionPanel'
import { VCol, VRow, VSpacer } from 'vuetify/components/VGrid'
import { VIcon } from 'vuetify/components/VIcon'
import { VList, VListItem } from 'vuetify/components/VList'
import { VMenu } from 'vuetify/components/VMenu'
import { VProgressLinear } from 'vuetify/components/VProgressLinear'
import { VSheet } from 'vuetify/components/VSheet'
import { VTable } from 'vuetify/components/VTable'
import { VTextField } from 'vuetify/components/VTextField'
import { VTooltip } from 'vuetify/components/VTooltip'
import App from './App.vue'

await mountApp(App, {
  VAlert,
  VApp,
  VBtn,
  VBtnToggle,
  VCard,
  VCardItem,
  VCardSubtitle,
  VCardText,
  VCardTitle,
  VChip,
  VChipGroup,
  VCol,
  VDivider,
  VExpansionPanel,
  VExpansionPanels,
  VExpansionPanelText,
  VIcon,
  VList,
  VListItem,
  VMenu,
  VProgressLinear,
  VRow,
  VSheet,
  VSpacer,
  VTable,
  VTextField,
  VTooltip,
})
