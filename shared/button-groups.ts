// The one look of grouped buttons, in Studio (vuetify.config.ts) and in the
// apps shipped with it (apps/shared/defaults.ts): a bordered, divided group
// of text buttons with square inner corners. Templates use a bare
// <v-btn-toggle> (one choice of several) or <v-btn-group> (related actions
// or menus) and style neither the group nor its buttons; ESLint refuses it.

export const buttonGroupDefaults = {
  VBtnToggle: { density: 'compact', rounded: 'lg', color: 'primary', border: true, divided: true, variant: 'text', VBtn: { rounded: false } },
  VBtnGroup: { density: 'compact', rounded: 'lg', border: true, divided: true, variant: 'text', VBtn: { rounded: false } },
} as const

/** Props that style a group; set them in the defaults above, never in a template. */
export const buttonGroupStyleProps = ['variant', 'color', 'base-color', 'density', 'rounded', 'tile', 'border', 'divided', 'elevation', 'size'] as const
