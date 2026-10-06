import type { DatabaseHandle } from '~~/server/lib/database/client'
import { sql } from 'drizzle-orm'
import { afterEach, describe, expect, it } from 'vitest'
import { openDatabase } from '~~/server/lib/database/client'
import { applyMigrations, loadMigrationsFromDirectory } from '~~/server/lib/database/migrate'
import { testenvAvailable, testenvDatabaseUrl } from '../support/testenv'

const migrationsDirectory = new URL('../../server/database/migrations', import.meta.url).pathname

const engines = [
  { name: 'PGlite (in memory)', open: () => openDatabase({ kind: 'memory' }), enabled: true },
  { name: 'PostgreSQL 18 (test environment)', open: () => openDatabase({ kind: 'postgres', url: testenvDatabaseUrl }), enabled: testenvAvailable },
]

describe.each(engines)('migrations on $name', ({ open, enabled }) => {
  let handle: DatabaseHandle | undefined

  afterEach(async () => {
    await handle?.close()
  })

  it.runIf(enabled)('applies the migration chain once and is idempotent', async () => {
    handle = await open()
    const migrations = await loadMigrationsFromDirectory(migrationsDirectory)
    expect(migrations.length).toBeGreaterThan(0)

    // The PostgreSQL test database may already be migrated by an earlier run.
    await applyMigrations(handle.db, migrations)
    expect(await applyMigrations(handle.db, migrations)).toEqual([])

    const tables = await handle.db.execute<{ table_name: string }>(sql`
      select table_name from information_schema.tables where table_schema = 'public' order by table_name`)
    expect(tables.rows.map(row => row.table_name)).toEqual(expect.arrayContaining([
      'audit_events',
      'infrastructures',
      'oidc_transactions',
      'studio_schema_migrations',
      'studio_sessions',
      'target_credentials',
    ]))
  })
})
