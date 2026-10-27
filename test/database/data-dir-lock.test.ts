// One owner per PGlite data directory (ADR 0011): `nuxt dev` starts the next
// Nitro worker before the previous one has closed its database.

import type { StudioConfig } from '~~/server/lib/config'
import type { StudioDeps } from '~~/server/lib/deps'
import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdtemp, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { installBundledApp, listInstallations } from '~~/server/lib/apps/store'
import { SecretCipher } from '~~/server/lib/crypto/cipher'
import { openDatabase } from '~~/server/lib/database/client'
import { lockDataDir } from '~~/server/lib/database/lock'
import { applyMigrations, loadMigrationsFromDirectory } from '~~/server/lib/database/migrate'
import { manifestOf, zipApp } from '../apps/support'

const migrationsDirectory = new URL('../../server/database/migrations', import.meta.url).pathname
const config = { deploymentMode: 'desktop' } as StudioConfig

/** Resolves to whether the promise settled within the time. */
async function settlesWithin (promise: Promise<unknown>, ms: number): Promise<boolean> {
  return Promise.race([promise.then(() => true, () => true), new Promise<boolean>(resolve => setTimeout(() => resolve(false), ms))])
}

describe('PGlite data directory lock', () => {
  const directories: string[] = []
  async function dataDir () {
    const directory = await mkdtemp(join(tmpdir(), 'studio-lock-'))
    directories.push(directory)
    return join(directory, 'db')
  }

  afterEach(async () => {
    await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })))
  })

  it('lets a second opener wait until the first releases the folder', async () => {
    const dir = await dataDir()
    const release = await lockDataDir(dir, { pollMs: 10 })
    const second = lockDataDir(dir, { pollMs: 10 })
    expect(await settlesWithin(second, 200)).toBe(false)
    await release()
    const releaseSecond = await second
    expect(existsSync(`${dir}.lock`)).toBe(true)
    await releaseSecond()
    expect(existsSync(`${dir}.lock`)).toBe(false)
  })

  it('gives up with a clear error while a live owner keeps the folder', async () => {
    const dir = await dataDir()
    const release = await lockDataDir(dir)
    await expect(lockDataDir(dir, { timeoutMs: 200, pollMs: 10 })).rejects.toThrow(`The database folder ${dir} is in use by another Studio service (process ${process.pid})`)
    await release()
  })

  it('takes over the lock of a process that has exited', async () => {
    const dir = await dataDir()
    const { pid } = spawnSync(process.execPath, ['-e', ''])
    await writeFile(`${dir}.lock`, JSON.stringify({ pid, threadId: 0, token: 'gone' }))
    const release = await lockDataDir(dir, { timeoutMs: 0 })
    await release()
  })

  it('takes over a lock its owner stopped refreshing, such as a terminated worker thread', async () => {
    const dir = await dataDir()
    await writeFile(`${dir}.lock`, JSON.stringify({ pid: process.pid, threadId: 99, token: 'terminated' }))
    const past = new Date(Date.now() - 60_000)
    await utimes(`${dir}.lock`, past, past)
    const release = await lockDataDir(dir, { timeoutMs: 0 })
    await release()
  })

  it('keeps a lock that has been taken over when the previous owner releases late', async () => {
    const dir = await dataDir()
    const releaseFirst = await lockDataDir(dir, { heartbeatMs: 60_000 })
    const past = new Date(Date.now() - 60_000)
    await utimes(`${dir}.lock`, past, past)
    const releaseSecond = await lockDataDir(dir, { staleMs: 1000, timeoutMs: 0 })
    await releaseFirst()
    expect(existsSync(`${dir}.lock`)).toBe(true)
    await releaseSecond()
  })

  it('runs overlapping Studio starts on one folder one after the other', async () => {
    const dir = await dataDir()
    const migrations = await loadMigrationsFromDirectory(migrationsDirectory)
    const start = async (version: string) => {
      const handle = await openDatabase({ kind: 'pglite', dataDir: dir })
      await applyMigrations(handle.db, migrations)
      const deps: StudioDeps = { config, db: handle.db, cipher: new SecretCipher(randomBytes(32)) }
      const html = `<p>${'x'.repeat(8192)} ${version}</p>`
      const outcome = await installBundledApp(deps, zipApp(manifestOf({ id: 'org.example.bundled', version }), { 'ui/index.html': html }))
      return { handle, deps, outcome }
    }

    const first = await start('1.0.0')
    // The reloaded worker starts while the previous one still owns the folder.
    const second = start('2.0.0')
    expect(await settlesWithin(second, 500)).toBe(false)
    await first.handle.close()
    const { handle, deps, outcome } = await second
    expect(first.outcome).toBe('installed')
    expect(outcome).toBe('updated')
    expect((await listInstallations(deps)).map(record => record.version)).toEqual(['2.0.0'])
    await handle.close()
  })
})
