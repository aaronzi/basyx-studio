import { z } from 'zod'

const keyList = z.array(z.string().regex(/^[\w-]{1,4000}$/)).max(50)

/**
 * Per-user settings, stored by Studio (PostgreSQL or PGlite). Favorites and
 * recently opened shells are shell keys per target, so switching targets
 * never shows another target's shells.
 */
export const preferencesSchema = z.object({
  favorites: z.record(z.string().max(100), keyList).default({}),
  recent: z.record(z.string().max(100), keyList).default({}),
  /** Preferred language of multi-language values, e.g. `en` or `de`. */
  valueLanguage: z.string().regex(/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})?$/).default('en'),
  autoRefresh: z.boolean().default(true),
  refreshIntervalSeconds: z.number().int().min(1).max(300).default(5),
})
export type Preferences = z.infer<typeof preferencesSchema>

export const defaultPreferences: Preferences = preferencesSchema.parse({})
