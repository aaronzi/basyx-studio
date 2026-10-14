import { z } from 'zod'
import { syncModes } from './infrastructure'

const shellKey = z.string().regex(/^[\w-]{1,4000}$/)
const keyList = z.array(shellKey).max(50)

/** A recently opened shell with the title it had; older entries are a bare key. */
const recentShell = z.union([
  z.object({ key: shellKey, title: z.string().max(500).nullable() }),
  shellKey.transform(key => ({ key, title: null })),
])
export type RecentShell = z.infer<typeof recentShell>

/**
 * Per-user settings, stored by Studio (PostgreSQL or PGlite). Favorites and
 * recently opened shells are shell keys per target, so switching targets
 * never shows another target's shells.
 */
export const preferencesSchema = z.object({
  favorites: z.record(z.string().max(100), keyList).default({}),
  recent: z.record(z.string().max(100), z.array(recentShell).max(50)).default({}),
  /** Preferred language of multi-language values, e.g. `en` or `de`. */
  valueLanguage: z.string().regex(/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})?$/).default('en'),
  theme: z.enum(['system', 'light', 'dark']).default('system'),
  /** Off by default, as auto-sync in the BaSyx Web UI: every open shell would poll its infrastructure. */
  autoRefresh: z.boolean().default(false),
  refreshIntervalSeconds: z.number().int().min(1).max(300).default(5),
  /**
   * Registry and discovery sync per infrastructure ID, where the
   * infrastructure lets users choose (MVP-4 plan, I5).
   */
  syncOverrides: z.record(z.string().max(100), z.enum(syncModes)).default({}),
})
export type Preferences = z.infer<typeof preferencesSchema>

export const defaultPreferences: Preferences = preferencesSchema.parse({})
