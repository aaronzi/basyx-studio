/** A part of the muted line under a resource's title (`ResourceHeader`). */
export interface HeaderMeta {
  text: string
  icon: string
  class?: string
}

/** An identifier row of the header: label, value and a copy button. */
export interface HeaderIdentifier {
  label: string
  value: string
  icon: string
}

/** A link of an action's menu, e.g. one export format. */
export interface HeaderActionItem {
  title: string
  subtitle?: string
  icon: string
  href: string
}

/**
 * An action of the header (package editing plan, H3). The header shows as
 * many inline as its width allows, the lowest `rank` first, and puts the
 * others into its ⋮ menu.
 */
export interface HeaderAction {
  id: string
  title: string
  icon: string
  rank: number
  onClick?: () => void
  /** A menu of links (the export formats): inline a button with a menu, in ⋮ a section. */
  items?: HeaderActionItem[]
  /** The view mode's own action (Export): tonal in the primary color. */
  primary?: boolean
  /** Only in the ⋮ menu, e.g. a second way to an action of the page. */
  menuOnly?: boolean
  /** In the ⋮ menu of the narrow layout only, where the header hides what offers it otherwise (the QR code). */
  narrowOnly?: boolean
  /** Only in the ⋮ menu, after a divider, in the error color (UX-003). */
  danger?: boolean
}

/** The header's layouts by the width of the content area (H2). */
export type HeaderLayout = 'wide' | 'medium' | 'narrow'

/** Widths of the content area, in px, from which the header is medium or wide. */
export const headerBreakpoints = { medium: 600, wide: 1000 } as const

/** How many actions stay inline in each layout. */
export const inlineActions: Record<HeaderLayout, number> = { wide: 3, medium: 2, narrow: 0 }

export function headerLayout (contentWidth: number): HeaderLayout {
  if (contentWidth >= headerBreakpoints.wide) {
    return 'wide'
  }
  return contentWidth >= headerBreakpoints.medium ? 'medium' : 'narrow'
}

/**
 * Splits the actions into those shown inline and those in the menu: as
 * many of the lowest ranks inline as the layout allows, in their given
 * order; `menuOnly`, `narrowOnly` and `danger` actions always in the menu.
 */
export function splitActions (actions: readonly HeaderAction[], layout: HeaderLayout): { inline: HeaderAction[], menu: HeaderAction[] } {
  const available = actions.filter(action => !action.narrowOnly || layout === 'narrow')
  const candidates = available.filter(action => !action.menuOnly && !action.danger && !action.narrowOnly)
  const shown = new Set(candidates.toSorted((a, b) => a.rank - b.rank).slice(0, inlineActions[layout]).map(action => action.id))
  return {
    inline: available.filter(action => shown.has(action.id)),
    menu: available.filter(action => !shown.has(action.id)),
  }
}
