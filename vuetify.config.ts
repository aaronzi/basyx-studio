import { defineVuetifyConfiguration } from 'vuetify-nuxt-module/custom-configuration'

// The single place for Studio's look and feel. Components rely on these
// defaults instead of repeating props, and on Vuetify utility classes instead
// of custom CSS (see AGENTS.md and the Vue rules in eslint.config.js).
//
// A calm, bordered look (MVP-4 plan, L2): Vuetify's own palette with the BaSyx
// brand colours, small radii, outlined fields, borders instead of shadows.

// BaSyx brand colours, taken from app/assets/basyx-logo.svg. Light-theme
// variants are darkened to keep at least 4.5:1 contrast with white (WCAG AA).
const brand = {
  cyan: '#00ADEE',
  orange: '#F69222',
  cyanOnLight: '#0077A6',
  orangeOnLight: '#A65400',
}

const field = { variant: 'outlined', density: 'comfortable', hideDetails: 'auto' } as const

export default defineVuetifyConfiguration({
  theme: {
    // An explicit theme, so server rendering and hydration agree: the module
    // picks light or dark from the color-scheme cookie or the
    // Sec-CH-Prefers-Color-Scheme client hint (nuxt.config.ts:
    // vuetify.moduleOptions.ssrClientHints). The user's choice in Settings
    // (including "system") is applied in app.vue after hydration.
    defaultTheme: 'light',
    themes: {
      light: {
        colors: { primary: brand.cyanOnLight, secondary: brand.orangeOnLight },
      },
      dark: {
        colors: { primary: brand.cyan, secondary: brand.orange },
      },
    },
  },

  // Below 960 px (md) drawers become temporary and the layout switches to the
  // phone navigation; Vuetify's default would do this up to 1280 px.
  display: { mobileBreakpoint: 'md' },

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
    VAvatar: { rounded: 'lg' },
    VBtn: { variant: 'text', rounded: 'lg', class: 'text-none' },
    VBtnPrimary: { color: 'primary', variant: 'flat', rounded: 'lg', class: 'text-none' },
    VBtnToggle: { density: 'compact', rounded: 'lg', color: 'primary' },
    VCard: { flat: true, border: true, rounded: 'lg' },
    VCardPane: {
      flat: true,
      border: true,
      rounded: 'lg',
      height: 'calc(100vh - 190px)',
      minHeight: 320,
      class: 'd-flex flex-column',
    },
    // Overlays keep a shadow so they stand out from the page.
    VDialog: { VCard: { flat: false } },
    VMenu: { VCard: { flat: false } },
    VList: { color: 'primary', density: 'comfortable', bgColor: 'transparent' },
    VListItem: { rounded: 'lg', VBtn: { size: 'small' } },
    VChip: { label: true, size: 'small', variant: 'tonal' },
    VAlert: { border: 'start', variant: 'tonal', VBtn: { size: 'small' } },
    VTextField: field,
    VSelect: field,
    VAutocomplete: field,
    VFileInput: field,
    VTextarea: field,
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
