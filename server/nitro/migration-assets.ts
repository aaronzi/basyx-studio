// Nitro-specific: `nuxt/server` has no storage API. Server assets come from
// Nitro storage (`nitro.serverAssets` in nuxt.config.ts); port this to
// `nitro/storage` when moving to Nitro v3 (Nuxt 5).
import type { Migration } from '../lib/database/migrate'
import { useStorage } from 'nitropack/runtime'
import { migrationsFromJournal } from '../lib/database/migrate'

export async function loadMigrationsFromAssets (): Promise<Migration[]> {
  const storage = useStorage('assets:migrations')
  const raw = async (key: string) => {
    const value = await storage.getItemRaw(key)
    if (value === null || value === undefined) {
      throw new Error(`Migration asset ${key} is missing.`)
    }
    return typeof value === 'string' ? value : Buffer.from(value as Uint8Array).toString('utf8')
  }
  return migrationsFromJournal(await raw('meta:_journal.json'), tag => raw(`${tag}.sql`))
}
