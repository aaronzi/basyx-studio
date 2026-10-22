import type { StudioClient } from '@basyx/studio-sdk'
import { mountApp } from '@basyx/studio-app-kit'
import { connect } from '@basyx/studio-sdk'
import { VAlert } from 'vuetify/components/VAlert'
import { VApp } from 'vuetify/components/VApp'
import { VBtn } from 'vuetify/components/VBtn'
import { VBtnToggle } from 'vuetify/components/VBtnToggle'
import { VCard, VCardText } from 'vuetify/components/VCard'
import { VChip } from 'vuetify/components/VChip'
import { VDivider } from 'vuetify/components/VDivider'
import { VCol, VContainer, VRow, VSpacer } from 'vuetify/components/VGrid'
import { VIcon } from 'vuetify/components/VIcon'
import { VList, VListItem } from 'vuetify/components/VList'
import { VMain } from 'vuetify/components/VMain'
import { VProgressCircular } from 'vuetify/components/VProgressCircular'
import { VProgressLinear } from 'vuetify/components/VProgressLinear'
import { VResponsive } from 'vuetify/components/VResponsive'
import { VTab, VTabs } from 'vuetify/components/VTabs'
import { VTextField } from 'vuetify/components/VTextField'
import { VToolbar, VToolbarTitle } from 'vuetify/components/VToolbar'
import App from './App.vue'
import OverviewPage from './pages/OverviewPage.vue'
import ShellPage from './pages/ShellPage.vue'
import ShellsPage from './pages/ShellsPage.vue'
import { createAppRouter } from './router'

// In Studio, the app connects to its frame. In `pnpm dev`, outside Studio,
// it runs on the test Studio of ./dev.ts, with the IFC model of Studio's
// test fixtures; `?locale=de&dark` tries a locale and the dark theme.
async function client (): Promise<StudioClient> {
  if (import.meta.env.DEV && window.parent === window) {
    const [{ createDevStudio }, { testTheme }, { default: ifcUrl }] = await Promise.all([
      import('./dev'),
      import('@basyx/studio-sdk/testing'),
      import('../../../../../test-setup/fixtures/models3d/workshop.ifc?url'),
    ])
    const ifc = new Uint8Array(await (await fetch(ifcUrl)).arrayBuffer())
    const query = new URLSearchParams(location.search)
    return createDevStudio({ locale: query.get('locale') ?? 'en', theme: testTheme(query.has('dark')) }, ifc).client
  }
  return connect()
}

await mountApp(App, {
  VAlert,
  VApp,
  VBtn,
  VBtnToggle,
  VCard,
  VCardText,
  VChip,
  VCol,
  VContainer,
  VDivider,
  VIcon,
  VList,
  VListItem,
  VMain,
  VProgressCircular,
  VProgressLinear,
  VResponsive,
  VRow,
  VSpacer,
  VTab,
  VTabs,
  VTextField,
  VToolbar,
  VToolbarTitle,
}, {
  client: client(),
  setup: (app, client) => {
    app.use(createAppRouter(client, { overview: OverviewPage, shells: ShellsPage, shell: ShellPage }))
  },
})
