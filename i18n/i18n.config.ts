import { en as vuetifyEn } from 'vuetify/locale'

// Vuetify reads its own texts (`$vuetify.*`, e.g. "No data available") through
// vue-i18n, so its messages are registered next to Studio's lazy-loaded ones.
export default defineI18nConfig(() => ({
  legacy: false,
  locale: 'en',
  fallbackLocale: 'en',
  messages: {
    en: { $vuetify: vuetifyEn },
  },
}))
