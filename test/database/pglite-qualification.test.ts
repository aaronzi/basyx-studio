// Evidence for the PGlite qualification gate of ADR 0011: crash safety,
// footprint, and the dump/restore path for engine upgrades.

import type { StudioDatabase } from '~~/server/lib/database/client'
import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { pgDump } from '@electric-sql/pglite-tools/pg_dump'
import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/pglite'
import { afterEach, describe, expect, it } from 'vitest'
import * as schema from '~~/server/database/schema'
import { openDatabase } from '~~/server/lib/database/client'
import { applyMigrations, loadMigrationsFromDirectory } from '~~/server/lib/database/migrate'

const migrationsDirectory = new URL('../../server/database/migrations', import.meta.url).pathname

// Inserts rows in separate transactions and reports each commit on stdout,
// until the parent kills it with SIGKILL.
const writerScript = String.raw`
import { PGlite } from '@electric-sql/pglite'
const db = new PGlite(process.argv[1])
await db.waitReady
await db.exec('create table if not exists crash_test (id integer primary key, payload text not null)')
for (let id = 1; ; id++) {
  await db.query('insert into crash_test (id, payload) values ($1, $2)', [id, 'x'.repeat(512)])
  process.stdout.write(id + '\n')
}
`

describe('PGlite qualification (ADR 0011)', () => {
  const directories: string[] = []
  async function scratch () {
    const directory = await mkdtemp(join(tmpdir(), 'studio-pglite-'))
    directories.push(directory)
    return directory
  }

  afterEach(async () => {
    await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })))
  })

  it('reopens after SIGKILL during writes and keeps every acknowledged commit', async () => {
    const dataDir = await scratch()
    const writer = spawn(process.execPath, ['--input-type=module', '-e', writerScript, dataDir], {
      cwd: process.cwd(),
      stdio: ['ignore', 'pipe', 'inherit'],
    })
    let acknowledged = 0
    await new Promise<void>((resolve, reject) => {
      writer.stdout.on('data', (chunk: Buffer) => {
        const ids = chunk.toString().trim().split('\n').map(Number).filter(id => Number.isFinite(id))
        acknowledged = Math.max(acknowledged, ...ids)
        if (acknowledged >= 300) {
          writer.kill('SIGKILL')
        }
      })
      writer.on('exit', () => resolve())
      writer.on('error', reject)
    })
    expect(acknowledged).toBeGreaterThanOrEqual(300)

    const reopened = new PGlite(dataDir)
    await reopened.waitReady
    const { rows } = await reopened.query<{ count: number }>('select count(*)::int as count from crash_test')
    await reopened.close()
    expect(rows[0]!.count).toBeGreaterThanOrEqual(acknowledged)
  }, 60_000)

  it('opens the Studio database with fsync enabled', async () => {
    const handle = await openDatabase({ kind: 'memory' })
    const result = await handle.db.execute(sql`show fsync`) as unknown as { rows: Array<{ fsync: string }> }
    await handle.close()
    expect(result.rows[0]?.fsync).toBe('on')
  })

  it('records cold-open time and memory of a migrated Studio database', async () => {
    const dataDir = await scratch()
    const first = await openDatabase({ kind: 'pglite', dataDir })
    await applyMigrations(first.db, await loadMigrationsFromDirectory(migrationsDirectory))
    await first.close()

    const rssBefore = process.memoryUsage().rss
    const started = performance.now()
    const reopened = await openDatabase({ kind: 'pglite', dataDir })
    const openMs = performance.now() - started
    const rssDeltaMb = (process.memoryUsage().rss - rssBefore) / 1024 / 1024
    await reopened.close()

    console.info(`[pglite] cold open ${openMs.toFixed(0)} ms, RSS +${rssDeltaMb.toFixed(0)} MB`)
    expect(openMs).toBeLessThan(5000)
  })

  it('dumps and restores a migrated Studio database into a fresh engine (major-version upgrade path)', async () => {
    const source = new PGlite()
    await source.waitReady
    await applyMigrations(drizzle(source, { schema }) as unknown as StudioDatabase, await loadMigrationsFromDirectory(migrationsDirectory))
    await source.query(
      `insert into infrastructures (id, name, endpoints, security, created_by) values ($1, $2, $3, $4, $5)`,
      ['infra-1', 'Probe', JSON.stringify([{ type: 'aasRepository', url: 'https://aas.example' }]), JSON.stringify({ mode: 'unsecured' }), 'test'],
    )
    const dump = await (await pgDump({ pg: source })).text()
    await source.close()

    const target = new PGlite()
    await target.waitReady
    await target.exec(dump)
    // pg_dump output clears search_path for the session; qualify explicitly.
    const infrastructures = await target.query<{ name: string, mode: string }>(`select name, security->>'mode' as mode from public.infrastructures`)
    const migrations = await target.query<{ tag: string }>('select tag from public.studio_schema_migrations')
    await target.close()
    expect(infrastructures.rows).toEqual([{ name: 'Probe', mode: 'unsecured' }])
    expect(migrations.rows.map(row => row.tag)).toContain('0000_initial')
  })
})
