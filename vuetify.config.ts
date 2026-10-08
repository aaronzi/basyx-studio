import { defineVuetifyConfiguration } from 'vuetify-nuxt-module/custom-configuration'

// The single place for Studio's look and feel. Components rely on these
// defaults instead of repeating props, and on Vuetify utility classes instead
// of custom CSS (see AGENTS.md and the Vue rules in eslint.config.js).

// BaSyx brand colours, taken from app/assets/basyx-logo.svg. Light-theme
// variants are darkened to keep at least 4.5:1 contrast with white (WCAG AA).
const brand = {
  cyan: '#00ADEE',
  orange: '#F69222',
  cyanOnLight: '#0077A6',
  orangeOnLight: '#A65400',
}

export default defineVuetifyConfiguration({
  theme: {
    // Follows the OS preference; SSR reads it from the Sec-CH-Prefers-Color-Scheme
    // client hint (nuxt.config.ts: vuetify.moduleOptions.ssrClientHints).
    defaultTheme: 'system',
    themes: {
      light: {
        colors: { primary: brand.cyanOnLight, secondary: brand.orangeOnLight },
      },
      dark: {
        colors: { primary: brand.cyan, secondary: brand.orange },
      },
    },
  },

  // Virtual components for recurring roles; use them instead of restating props.
  aliases: {
    // The main action of a view or dialog (save, sign in, add, delete).
    VBtnPrimary: 'VBtn',
    // Pane container of the shell browser: fixed height, scrolling body.
    VCardPane: 'VCard',
  },

  defaults: {
    VAppBar: { flat: true, border: 'b', density: 'comfortable' },
    VBtn: { variant: 'text' },
    VBtnPrimary: { color: 'primary', variant: 'flat' },
    VCard: { variant: 'outlined' },
    VCardPane: {
      variant: 'outlined',
      height: 'calc(100vh - 190px)',
      minHeight: 320,
      class: 'd-flex flex-column',
    },
    // Dialog content opens in an overlay and starts from the global defaults.
    VDialog: { VCard: { variant: 'elevated' } },
    VList: { color: 'primary' },
    VListItem: { VBtn: { size: 'small' } },
    VChip: { label: true, size: 'small', variant: 'tonal' },
    VAlert: { border: 'start', variant: 'tonal', VBtn: { size: 'small' } },
    VTextField: { variant: 'outlined', density: 'comfortable' },
    VSelect: { variant: 'outlined', density: 'comfortable' },
    VCheckbox: { density: 'compact', color: 'primary' },
    VProgressLinear: { indeterminate: true, color: 'primary' },
    VBreadcrumbs: { class: 'pa-0' },
    VTreeview: { density: 'compact', activatable: true, color: 'primary' },
    VContainer: { maxWidth: 1100, class: 'py-6' },
  },
})
