// One owner per PGlite data directory (ADR 0011): `nuxt dev` starts the next
// Nitro worker before the previous one has closed its database.

import type { StudioConfig } from '~~/server/lib/config'
import type { StudioDeps } from '~~/server/lib/deps'
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { hostname, tmpdir } from 'node:os'
import { join } from 'node:path'
import { Worker } from 'node:worker_threads'
import { afterEach, describe, expect, it } from 'vitest'
import { installBundledApp, listInstallations } from '~~/server/lib/apps/store'
import { SecretCipher } from '~~/server/lib/crypto/cipher'
import { openDatabase } from '~~/server/lib/database/client'
import { lockDataDir } from '~~/server/lib/database/lock'
import { applyMigrations, loadMigrationsFromDirectory } from '~~/server/lib/database/migrate'
import { manifestOf, zipApp } from '../apps/support'

const migrationsDirectory = new URL('../../server/database/migrations', import.meta.url).pathname
const config = { deploymentMode: 'desktop' } as StudioConfig

// An owner in a worker thread: listens on its socket, then blocks its event
// loop as a long synchronous operation or a debugger pause would.
const ownerThread = `
const { createServer } = require('node:net')
const { parentPort, workerData } = require('node:worker_threads')
createServer(socket => socket.destroy()).listen(workerData.address, () => {
  parentPort.postMessage('listening')
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, workerData.blockMs)
})
`

/** Resolves to whether the promise settled within the time. */
async function settlesWithin (promise: Promise<unknown>, ms: number): Promise<boolean> {
  return Promise.race([promise.then(() => true, () => true), new Promise<boolean>(resolve => setTimeout(() => resolve(false), ms))])
}

describe('PGlite data directory lock', () => {
  const directories: string[] = []
  const workers: Worker[] = []
  async function scratch () {
    const directory = await mkdtemp(join(tmpdir(), 'studio-lock-'))
    directories.push(directory)
    return directory
  }

  /** Records an owner of generation 1, as a previous Studio service would have. */
  async function previousOwner (dataDir: string, address: string, host = hostname()) {
    await mkdir(`${dataDir}.lock`, { recursive: true })
    await writeFile(join(`${dataDir}.lock`, '1'), JSON.stringify({ pid: 4242, host, address }))
  }

  async function ownerInThread (address: string, blockMs: number) {
    const worker = new Worker(ownerThread, { eval: true, workerData: { address, blockMs } })
    workers.push(worker)
    await new Promise(resolve => worker.once('message', resolve))
    return worker
  }

  afterEach(async () => {
    await Promise.all(workers.splice(0).map(worker => worker.terminate()))
    await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })))
  })

  it('lets a second opener wait until the first releases the folder', async () => {
    const dir = join(await scratch(), 'db')
    const release = await lockDataDir(dir, { pollMs: 10 })
    const second = lockDataDir(dir, { pollMs: 10 })
    expect(await settlesWithin(second, 200)).toBe(false)
    await release()
    const releaseSecond = await second
    expect((await readdir(`${dir}.lock`)).filter(name => !name.endsWith('.sock'))).toEqual(['2'])
    await releaseSecond()
  })

  it('gives up with a clear error while a live owner keeps the folder', async () => {
    const dir = join(await scratch(), 'db')
    const release = await lockDataDir(dir)
    await expect(lockDataDir(dir, { timeoutMs: 200, pollMs: 10 })).rejects.toThrow(`The database folder ${dir} is in use by another Studio service (process ${process.pid})`)
    await release()
  })

  it('does not take over an owner that is blocked or paused', async () => {
    const directory = await scratch()
    const dir = join(directory, 'db')
    const address = join(directory, 'owner.sock')
    await ownerInThread(address, 5000)
    await previousOwner(dir, address)
    await expect(lockDataDir(dir, { timeoutMs: 1000, pollMs: 50 })).rejects.toThrow('is in use by another Studio service (process 4242)')
  })

  it('takes over from a worker thread that was terminated', async () => {
    const directory = await scratch()
    const dir = join(directory, 'db')
    const address = join(directory, 'owner.sock')
    const worker = await ownerInThread(address, 0)
    await previousOwner(dir, address)
    await worker.terminate()
    await (await lockDataDir(dir, { timeoutMs: 0 }))()
  })

  it('takes over from a process that was killed', async () => {
    const directory = await scratch()
    const dir = join(directory, 'db')
    const address = join(directory, 'owner.sock')
    const owner = spawn(process.execPath, ['-e', `require('node:net').createServer().listen(${JSON.stringify(address)}, () => console.log('listening'))`], { stdio: ['ignore', 'pipe', 'inherit'] })
    await new Promise(resolve => owner.stdout.once('data', resolve))
    await previousOwner(dir, address)
    owner.kill('SIGKILL')
    await new Promise(resolve => owner.once('exit', resolve))
    await (await lockDataDir(dir, { timeoutMs: 0 }))()
  })

  it('never takes over an owner on another host', async () => {
    const directory = await scratch()
    const dir = join(directory, 'db')
    await previousOwner(dir, join(directory, 'owner.sock'), 'other-host')
    await expect(lockDataDir(dir, { timeoutMs: 200, pollMs: 10 })).rejects.toThrow('(process 4242 on other-host)')
  })

  it('gives an abandoned folder to one opener at a time', async () => {
    const directory = await scratch()
    const dir = join(directory, 'db')
    await previousOwner(dir, join(directory, 'gone.sock'))
    let owners = 0
    let most = 0
    await Promise.all(Array.from({ length: 6 }, async () => {
      const release = await lockDataDir(dir, { pollMs: 5 })
      most = Math.max(most, ++owners)
      await new Promise(resolve => setTimeout(resolve, 30))
      owners--
      await release()
    }))
    expect(most).toBe(1)
  })

  it('runs overlapping Studio starts on one folder one after the other', async () => {
    const dir = join(await scratch(), 'db')
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
