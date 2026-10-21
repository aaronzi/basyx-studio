import type { I18n } from '@basyx/studio-app-kit/i18n'
import type { StudioClient } from '@basyx/studio-sdk'
import { provideI18n as provideAppI18n } from '@basyx/studio-app-kit/i18n'
import de from './locales/de.json'
import en from './locales/en.json'

// The app's texts, in nested sections; the locale follows Studio's, and
// missing texts are English. Numbers and dates use `formatLocale`, so they
// match the texts shown.

export { useI18n } from '@basyx/studio-app-kit/i18n'

export function provideI18n (client: StudioClient): I18n {
  return provideAppI18n(client, en, { de })
}
