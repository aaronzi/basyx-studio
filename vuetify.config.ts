import { defineVuetifyConfiguration } from 'vuetify-nuxt-module/custom-configuration'
import { md3 } from 'vuetify/blueprints'

// The single place for Studio's look and feel. Components rely on these
// defaults instead of repeating props, and on Vuetify utility classes instead
// of custom CSS (see AGENTS.md and the Vue rules in eslint.config.js).
//
// The look follows the AAS viewer prototype (Material 3, rounded bordered
// cards, filled fields) with the BaSyx brand colours (plan D1).

// BaSyx brand colours, taken from app/assets/basyx-logo.svg. Light-theme
// variants are darkened to keep at least 4.5:1 contrast with white (WCAG AA).
const brand = {
  cyan: '#00ADEE',
  orange: '#F69222',
  cyanOnLight: '#0077A6',
  orangeOnLight: '#A65400',
}

const field = { variant: 'solo-filled', flat: true, density: 'comfortable', rounded: 'lg', hideDetails: 'auto' } as const

export default defineVuetifyConfiguration({
  blueprint: md3,

  theme: {
    // An explicit theme, so server rendering and hydration agree: the module
    // picks light or dark from the color-scheme cookie or the
    // Sec-CH-Prefers-Color-Scheme client hint (nuxt.config.ts:
    // vuetify.moduleOptions.ssrClientHints). The user's choice in Settings
    // (including "system") is applied in app.vue.
    defaultTheme: 'light',
    themes: {
      light: {
        dark: false,
        colors: {
          'primary': brand.cyanOnLight,
          'secondary': brand.orangeOnLight,
          'tertiary': '#5F4BB6',
          'background': '#F5F6FA',
          'surface': '#FFFFFF',
          'surface-light': '#EEF0F7',
          'surface-variant': '#E4E7F2',
          'success': '#2F9E44',
          'warning': '#B35C00',
          'error': '#D32F2F',
          'info': '#1C6FC0',
        },
      },
      dark: {
        dark: true,
        colors: {
          'primary': brand.cyan,
          'secondary': brand.orange,
          'tertiary': '#B197FC',
          'background': '#0F1117',
          'surface': '#171A23',
          'surface-light': '#1F2330',
          'surface-variant': '#2A2F3F',
          'success': '#69DB7C',
          'warning': '#FFA94D',
          'error': '#FF8787',
          'info': '#74C0FC',
        },
      },
    },
  },

  // Virtual components for recurring roles; use them instead of restating props.
  aliases: {
    // The main action of a view or dialog (save, sign in, add, delete).
    VBtnPrimary: 'VBtn',
    // Pane container of a full-height page area: fixed height, scrolling body.
    VCardPane: 'VCard',
  },

  defaults: {
    VAppBar: { flat: true, border: 'b', density: 'comfortable' },
    VNavigationDrawer: { border: 'e' },
    VBtn: { variant: 'text', rounded: 'lg', class: 'text-none' },
    VBtnPrimary: { color: 'primary', variant: 'flat', rounded: 'lg', class: 'text-none' },
    VBtnToggle: { density: 'compact', rounded: 'lg', color: 'primary' },
    VCard: { flat: true, border: true, rounded: 'xl' },
    VCardPane: {
      flat: true,
      border: true,
      rounded: 'xl',
      height: 'calc(100vh - 190px)',
      minHeight: 320,
      class: 'd-flex flex-column',
    },
    // Dialog content opens in an overlay and starts from the global defaults.
    VDialog: { VCard: { flat: false, border: false } },
    VMenu: { VCard: { flat: false, border: false } },
    VList: { color: 'primary', density: 'comfortable', bgColor: 'transparent' },
    VListItem: { rounded: 'lg', VBtn: { size: 'small' } },
    VChip: { rounded: 'lg', size: 'small', variant: 'tonal' },
    VAlert: { border: 'start', variant: 'tonal', VBtn: { size: 'small' } },
    VTextField: field,
    VSelect: field,
    VAutocomplete: field,
    VFileInput: field,
    VTextarea: { variant: 'solo-filled', flat: true, rounded: 'lg', hideDetails: 'auto' },
    VCheckbox: { density: 'compact', color: 'primary' },
    VSwitch: { color: 'primary', inset: true, hideDetails: true, density: 'compact' },
    VProgressLinear: { indeterminate: true, color: 'primary' },
    VBreadcrumbs: { class: 'pa-0' },
    VTreeview: { density: 'compact', activatable: true, color: 'primary' },
    VTooltip: { location: 'bottom', openDelay: 400 },
    VExpansionPanels: { variant: 'accordion', flat: true },
    VDataTable: { hover: true, density: 'comfortable' },
    VTabs: { color: 'primary', density: 'comfortable' },
    VContainer: { fluid: true, maxWidth: 1280, class: 'pa-4 pa-md-6' },
  },
})
