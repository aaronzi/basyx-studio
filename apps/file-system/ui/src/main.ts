import { mountApp } from '@basyx/studio-app-kit'
import { VAlert } from 'vuetify/components/VAlert'
import { VApp } from 'vuetify/components/VApp'
import { VBreadcrumbs, VBreadcrumbsItem } from 'vuetify/components/VBreadcrumbs'
import { VCardActions, VCardItem, VCardText, VCardTitle } from 'vuetify/components/VCard'
import { VCheckboxBtn } from 'vuetify/components/VCheckbox'
import { VCode } from 'vuetify/components/VCode'
import { VDataTable } from 'vuetify/components/VDataTable'
import { VDivider } from 'vuetify/components/VDivider'
import { VEmptyState } from 'vuetify/components/VEmptyState'
import { VFileInput } from 'vuetify/components/VFileInput'
import { VCol, VRow, VSpacer } from 'vuetify/components/VGrid'
import { VIcon } from 'vuetify/components/VIcon'
import { VImg } from 'vuetify/components/VImg'
import { VList, VListItem, VListItemTitle } from 'vuetify/components/VList'
import { VMenu } from 'vuetify/components/VMenu'
import { VOverlay } from 'vuetify/components/VOverlay'
import { VProgressCircular } from 'vuetify/components/VProgressCircular'
import { VProgressLinear } from 'vuetify/components/VProgressLinear'
import { VResponsive } from 'vuetify/components/VResponsive'
import { VSelect } from 'vuetify/components/VSelect'
import { VSheet } from 'vuetify/components/VSheet'
import { VTextField } from 'vuetify/components/VTextField'
import { VToolbar, VToolbarTitle } from 'vuetify/components/VToolbar'
import App from './App.vue'

await mountApp(App, {
  VAlert,
  VApp,
  VBreadcrumbs,
  VBreadcrumbsItem,
  VCardActions,
  VCardItem,
  VCardText,
  VCardTitle,
  VCheckboxBtn,
  VCode,
  VCol,
  VDataTable,
  VDivider,
  VEmptyState,
  VFileInput,
  VIcon,
  VImg,
  VList,
  VListItem,
  VListItemTitle,
  VMenu,
  VOverlay,
  VProgressCircular,
  VProgressLinear,
  VResponsive,
  VRow,
  VSelect,
  VSheet,
  VSpacer,
  VTextField,
  VToolbar,
  VToolbarTitle,
})
