import { randomUUID } from 'node:crypto'
import { readFile, stat, unlink, utimes, writeFile } from 'node:fs/promises'
import { threadId } from 'node:worker_threads'

export interface DataDirLockOptions {
  /** How long to wait for the current owner to release the folder. */
  timeoutMs?: number
  /** A lock whose owner has not refreshed it for this long is abandoned. */
  staleMs?: number
  /** How often the owner refreshes its lock. */
  heartbeatMs?: number
  pollMs?: number
}

interface LockOwner {
  pid: number
  threadId: number
  token: string
}

const defaults = { timeoutMs: 60_000, staleMs: 30_000, heartbeatMs: 5000, pollMs: 100 }

function errorCode (error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException | undefined)?.code
}

function processAlive (pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    // EPERM: the process exists but belongs to another user.
    return errorCode(error) === 'EPERM'
  }
}

async function readOwner (path: string): Promise<{ owner: LockOwner | null, refreshedAt: number } | null> {
  try {
    const [text, info] = await Promise.all([readFile(path, 'utf8'), stat(path)])
    let owner: LockOwner | null = null
    try {
      owner = JSON.parse(text) as LockOwner
    } catch {
      // Being written right now; judged by its age only.
    }
    return { owner, refreshedAt: info.mtimeMs }
  } catch (error) {
    if (errorCode(error) === 'ENOENT') {
      return null
    }
    throw error
  }
}

/**
 * Makes the caller the only owner of a PGlite data directory and returns the
 * function that gives it up. PGlite has no lock of its own: two instances on
 * one folder each keep their own buffers and WAL position and damage its
 * files (ADR 0011). `nuxt dev` starts the next Nitro worker before the
 * previous one has closed its database, so a second opener waits here until
 * the folder is released. A lock whose process has exited, or whose owner
 * stopped refreshing it (a terminated worker thread), is taken over.
 */
export async function lockDataDir (dataDir: string, options: DataDirLockOptions = {}): Promise<() => Promise<void>> {
  const { timeoutMs, staleMs, heartbeatMs, pollMs } = { ...defaults, ...options }
  const path = `${dataDir}.lock`
  const owner: LockOwner = { pid: process.pid, threadId, token: randomUUID() }
  const deadline = Date.now() + timeoutMs

  while (true) {
    try {
      await writeFile(path, JSON.stringify(owner), { flag: 'wx' })
      break
    } catch (error) {
      if (errorCode(error) !== 'EEXIST') {
        throw error
      }
    }
    const current = await readOwner(path)
    if (!current) {
      continue
    }
    const holder = current.owner
    const abandoned = (holder !== null && !processAlive(holder.pid)) || Date.now() - current.refreshedAt > staleMs
    if (abandoned) {
      await unlink(path).catch(error => {
        if (errorCode(error) !== 'ENOENT') {
          throw error
        }
      })
      continue
    }
    if (Date.now() >= deadline) {
      const by = holder ? ` (process ${holder.pid})` : ''
      throw new Error(`The database folder ${dataDir} is in use by another Studio service${by}. Stop it and start Studio again.`)
    }
    await new Promise(resolve => setTimeout(resolve, pollMs))
  }

  const heartbeat = setInterval(() => {
    const now = new Date()
    utimes(path, now, now).catch(() => {})
  }, heartbeatMs)
  heartbeat.unref()

  return async () => {
    clearInterval(heartbeat)
    const current = await readOwner(path)
    if (current?.owner?.token === owner.token) {
      await unlink(path).catch(() => {})
    }
  }
}
