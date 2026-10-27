import type { Server } from 'node:net'
import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'
import { link, mkdir, readdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { createConnection, createServer } from 'node:net'
import { hostname, tmpdir } from 'node:os'
import { join } from 'node:path'

export interface DataDirLockOptions {
  /** How long to wait for the current owner to release the folder. */
  timeoutMs?: number
  pollMs?: number
}

interface LockOwner {
  pid: number
  host: string
  /** The local socket only this owner listens on. */
  address: string
}

const defaults = { timeoutMs: 60_000, pollMs: 100 }
// Unix socket paths are limited to 104 bytes on macOS and 108 on Linux.
const maxSocketPathBytes = 100
const probeTimeoutMs = 2000

function errorCode (error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException | undefined)?.code
}

function socketAddress (lockDir: string, id: string): string {
  if (process.platform === 'win32') {
    return String.raw`\\.\pipe\basyx-studio-db-` + id
  }
  const address = [join(lockDir, `${id}.sock`), join(tmpdir(), `basyx-studio-db-${id}.sock`)]
    .find(path => Buffer.byteLength(path) <= maxSocketPathBytes)
  if (!address) {
    throw new Error(`No socket path for the database lock fits in ${maxSocketPathBytes} bytes; set TMPDIR to a shorter folder.`)
  }
  return address
}

async function listen (address: string): Promise<Server> {
  const server = createServer(socket => socket.destroy())
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(address, () => {
      server.off('error', reject)
      resolve()
    })
  })
  server.unref()
  return server
}

function close (server: Server): Promise<void> {
  return new Promise(resolve => server.close(() => resolve()))
}

/**
 * Whether an owner may still use the database. The OS closes an owner's
 * socket only when it releases the lock or its process or worker thread
 * ends; a paused or busy owner still accepts connections. An owner on
 * another host cannot be checked.
 */
async function ownerAlive (owner: LockOwner): Promise<boolean> {
  if (owner.host !== hostname()) {
    return true
  }
  return new Promise(resolve => {
    const socket = createConnection(owner.address)
    const settle = (alive: boolean) => {
      socket.destroy()
      resolve(alive)
    }
    socket.setTimeout(probeTimeoutMs, () => settle(true))
    socket.once('connect', () => settle(true))
    socket.once('error', error => settle(!['ECONNREFUSED', 'ENOENT'].includes(errorCode(error) ?? '')))
  })
}

async function generations (lockDir: string): Promise<number[]> {
  return (await readdir(lockDir)).filter(name => /^\d+$/.test(name)).map(Number).toSorted((a, b) => a - b)
}

async function readOwner (lockDir: string, generation: number): Promise<LockOwner | null> {
  try {
    return JSON.parse(await readFile(join(lockDir, String(generation)), 'utf8')) as LockOwner
  } catch (error) {
    if (errorCode(error) === 'ENOENT') {
      return null
    }
    throw error
  }
}

async function removeGeneration (lockDir: string, generation: number): Promise<void> {
  await unlink(join(lockDir, String(generation))).catch(error => {
    if (errorCode(error) !== 'ENOENT') {
      throw error
    }
  })
}

/** Creates the record of a generation, complete or not at all; false when it exists. */
async function createGeneration (lockDir: string, generation: number, owner: LockOwner): Promise<boolean> {
  const draft = join(lockDir, `draft-${randomUUID()}`)
  await writeFile(draft, JSON.stringify(owner))
  try {
    await link(draft, join(lockDir, String(generation)))
    return true
  } catch (error) {
    if (errorCode(error) === 'EEXIST') {
      return false
    }
    throw error
  } finally {
    await unlink(draft)
  }
}

/**
 * Makes the caller the only owner of a PGlite data directory and returns the
 * function that gives it up. PGlite has no lock of its own: two instances on
 * one folder each keep their own buffers and WAL position and damage its
 * files (ADR 0011). `nuxt dev` starts the next Nitro worker before the
 * previous one has closed its database, so a second opener waits here until
 * the folder is released.
 *
 * Owners are numbered generations in `<dataDir>.lock`; the highest one owns
 * the folder. Taking over means creating the next generation, which only
 * one opener can do, and only once the previous owner's socket refuses
 * connections: it released the lock, or its process or worker thread ended.
 */
export async function lockDataDir (dataDir: string, options: DataDirLockOptions = {}): Promise<() => Promise<void>> {
  const { timeoutMs, pollMs } = { ...defaults, ...options }
  const lockDir = `${dataDir}.lock`
  await mkdir(lockDir, { recursive: true })
  const owner: LockOwner = {
    pid: process.pid,
    host: hostname(),
    address: socketAddress(lockDir, randomUUID().replaceAll('-', '').slice(0, 16)),
  }
  const server = await listen(owner.address)
  const deadline = Date.now() + timeoutMs

  try {
    while (true) {
      const highest = (await generations(lockDir)).at(-1) ?? 0
      if (highest > 0) {
        const current = await readOwner(lockDir, highest)
        if (!current) {
          // Removed after a newer generation was claimed.
          continue
        }
        if (await ownerAlive(current)) {
          if (Date.now() >= deadline) {
            const where = current.host === owner.host ? '' : ` on ${current.host}`
            throw new Error(`The database folder ${dataDir} is in use by another Studio service (process ${current.pid}${where}). Stop it and start Studio again.`)
          }
          await new Promise(resolve => setTimeout(resolve, pollMs))
          continue
        }
      }
      const generation = highest + 1
      if (!await createGeneration(lockDir, generation, owner)) {
        continue
      }
      // An opener that judged an older owner may have recreated a generation
      // that a newer owner had already removed; the highest one decides.
      if ((await generations(lockDir)).at(-1) !== generation) {
        await removeGeneration(lockDir, generation)
        continue
      }
      for (const older of (await generations(lockDir)).filter(other => other < generation)) {
        await removeGeneration(lockDir, older)
      }
      return () => close(server)
    }
  } catch (error) {
    await close(server)
    throw error
  }
}
