import type { StudioClient } from '@basyx/studio-sdk'
import { mountApp } from '@basyx/studio-app-kit'
import { connect } from '@basyx/studio-sdk'
import { VAlert } from 'vuetify/components/VAlert'
import { VApp } from 'vuetify/components/VApp'
import { VBtn } from 'vuetify/components/VBtn'
import { VCard } from 'vuetify/components/VCard'
import { VChip } from 'vuetify/components/VChip'
import { VIcon } from 'vuetify/components/VIcon'
import { VList, VListItem } from 'vuetify/components/VList'
import { VProgressLinear } from 'vuetify/components/VProgressLinear'
import App from './App.vue'

// In Studio, the app connects to its frame. In `pnpm dev`, outside Studio,
// it runs on the test Studio of ./dev.ts; `?locale=de&dark` tries a locale
// and the dark theme. Production builds leave ./dev.ts out.
async function client (): Promise<StudioClient> {
  if (import.meta.env.DEV && window.parent === window) {
    const [{ createDevStudio }, { testTheme }] = await Promise.all([import('./dev'), import('@basyx/studio-sdk/testing')])
    const query = new URLSearchParams(location.search)
    return createDevStudio({ locale: query.get('locale') ?? 'en', theme: testTheme(query.has('dark')) }).client
  }
  return connect()
}

await mountApp(App, { VAlert, VApp, VBtn, VCard, VChip, VIcon, VList, VListItem, VProgressLinear }, { client: client() })
