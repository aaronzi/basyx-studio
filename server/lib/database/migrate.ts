import type { StudioDatabase } from './client'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { sql } from 'drizzle-orm'

export interface Migration {
  tag: string
  sql: string
}

interface Journal {
  entries: Array<{ idx: number, tag: string }>
}

// Arbitrary constant identifying the Studio migration lock.
const migrationLockId = 7_240_011

/**
 * Applies drizzle-kit generated SQL migrations in journal order. The same
 * runner serves PostgreSQL and PGlite (ADR 0011). All pending migrations run in
 * one transaction under an advisory lock, so concurrently starting hosted
 * instances cannot apply a migration twice.
 */
export async function applyMigrations (db: StudioDatabase, migrations: Migration[]): Promise<string[]> {
  return db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(${migrationLockId})`)
    await tx.execute(sql`
      create table if not exists studio_schema_migrations (
        tag text primary key,
        applied_at timestamp with time zone not null default now()
      )`)
    // Both drivers (node-postgres and PGlite) return the rows under `rows`.
    const applied = await tx.execute(sql`select tag from studio_schema_migrations`) as unknown as { rows: Array<{ tag: string }> }
    const appliedTags = new Set(applied.rows.map(row => row.tag))

    const newlyApplied: string[] = []
    for (const migration of migrations) {
      if (appliedTags.has(migration.tag)) {
        continue
      }
      for (const statement of migration.sql.split('--> statement-breakpoint')) {
        if (statement.trim()) {
          await tx.execute(sql.raw(statement))
        }
      }
      await tx.execute(sql`insert into studio_schema_migrations (tag) values (${migration.tag})`)
      newlyApplied.push(migration.tag)
    }
    return newlyApplied
  })
}

export function migrationsFromJournal (journalJson: string, readSql: (tag: string) => Promise<string>): Promise<Migration[]> {
  const journal = JSON.parse(journalJson) as Journal
  const entries = journal.entries.toSorted((a, b) => a.idx - b.idx)
  return Promise.all(entries.map(async entry => ({ tag: entry.tag, sql: await readSql(entry.tag) })))
}

export async function loadMigrationsFromDirectory (directory: string): Promise<Migration[]> {
  const journal = await readFile(join(directory, 'meta', '_journal.json'), 'utf8')
  return migrationsFromJournal(journal, tag => readFile(join(directory, `${tag}.sql`), 'utf8'))
}
