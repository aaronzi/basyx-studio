// Interleavings of openers that take over an abandoned PGlite data directory
// lock. Claiming a generation (`link`) is held back for one opener, so it
// acts on what it saw before the others claimed the folder.

import type * as fs from 'node:fs/promises'
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { hostname, tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { lockDataDir } from '~~/server/lib/database/lock'

const held = vi.hoisted(() => ({ next: null as null | { entered: () => void, proceed: Promise<void> } }))

vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof fs>()
  return {
    ...actual,
    link: async (...args: Parameters<typeof actual.link>) => {
      const gate = held.next
      if (gate) {
        held.next = null
        gate.entered()
        await gate.proceed
      }
      return actual.link(...args)
    },
  }
})

/** Holds back the next claim until `proceed` is called. */
function holdNextClaim () {
  let entered!: () => void
  let proceed!: () => void
  const reached = new Promise<void>(resolve => {
    entered = resolve
  })
  const released = new Promise<void>(resolve => {
    proceed = resolve
  })
  held.next = { entered, proceed: released }
  return { reached, proceed }
}

async function settlesWithin (promise: Promise<unknown>, ms: number): Promise<boolean> {
  return Promise.race([promise.then(() => true, () => true), new Promise<boolean>(resolve => setTimeout(() => resolve(false), ms))])
}

describe('PGlite data directory lock takeover', () => {
  const directories: string[] = []

  async function abandonedFolder () {
    const directory = await mkdtemp(join(tmpdir(), 'studio-lock-'))
    directories.push(directory)
    const dir = join(directory, 'db')
    await mkdir(`${dir}.lock`)
    await writeFile(join(`${dir}.lock`, '1'), JSON.stringify({ pid: 4242, host: hostname(), address: join(directory, 'gone.sock') }))
    return dir
  }

  afterEach(async () => {
    held.next = null
    await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })))
  })

  it('lets only one of two openers that saw the same abandoned owner take over', async () => {
    const dir = await abandonedFolder()
    const slow = holdNextClaim()
    const late = lockDataDir(dir, { pollMs: 10 })
    await slow.reached
    const releaseFirst = await lockDataDir(dir, { pollMs: 10 })
    slow.proceed()
    expect(await settlesWithin(late, 300)).toBe(false)
    await releaseFirst()
    await (await late)()
  })

  it('keeps an opener out that recreates a generation a newer owner removed', async () => {
    const dir = await abandonedFolder()
    const slow = holdNextClaim()
    // Saw generation 1 abandoned and is about to claim generation 2.
    const late = lockDataDir(dir, { pollMs: 10 })
    await slow.reached
    await (await lockDataDir(dir, { pollMs: 10 }))()
    // Generation 3 removes generations 1 and 2.
    const releaseThird = await lockDataDir(dir, { pollMs: 10 })
    expect((await readdir(`${dir}.lock`)).filter(name => /^\d+$/.test(name))).toEqual(['3'])
    slow.proceed()
    expect(await settlesWithin(late, 300)).toBe(false)
    await releaseThird()
    await (await late)()
  })
})
