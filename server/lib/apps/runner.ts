import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { connect } from 'node:net'
import { dirname, join } from 'node:path'
import { StudioProblem } from '../problem'

/** The code and files of one installed backend. */
export interface BackendSource {
  installationId: string
  appId: string
  /** Package-relative path of the backend's ES module entry. */
  entry: string
  /** Module files to extract (JavaScript, JSON, WebAssembly). */
  files: Map<string, Uint8Array>
}

/** What a backend's handler gets next to `studio` for one call: the app's settings and connection status for its target (ADR 0048). */
export interface BackendCallContext {
  settings: Record<string, unknown>
  connections: Record<string, { bound: boolean }>
}

export interface BackendRunnerOptions {
  denoPath: string
  /** Directory for extracted backends and Deno's cache. */
  workDir: string
  /**
   * The only address the backend may reach: this service on loopback. If the
   * service does not answer there, the other loopback address (127.0.0.1 or
   * [::1]) is used, as a server bound to `localhost` may listen on one only.
   */
  capabilityUrl: string
  /** Path of the app-calls endpoint there, under the deployment's base path. */
  callPath?: string
  callTimeoutMs?: number
  startupTimeoutMs?: number
  idleTimeoutMs?: number
  /** V8 heap limit per backend process. */
  memoryMb?: number
  /** Most bytes of one answer from a backend. */
  maxMessageBytes?: number
}

const harnessFile = '__studio_host__.mjs'

/** Whether something accepts TCP connections on a host (an IPv6 address in brackets) and port. */
function accepts (host: string, port: number, timeoutMs: number): Promise<boolean> {
  return new Promise(resolve => {
    const socket = connect({ host: host.replace(/^\[(.*)\]$/, '$1'), port, timeout: timeoutMs })
    const done = (ok: boolean) => {
      socket.destroy()
      resolve(ok)
    }
    socket.once('connect', () => done(true))
    socket.once('timeout', () => done(false))
    socket.once('error', () => done(false))
  })
}

/**
 * The loopback URL on which the service answers: the configured one, else the
 * same port on the other loopback address. `null` when neither answers.
 */
export async function reachableLoopbackUrl (configured: string, timeoutMs = 1000): Promise<string | null> {
  const url = new URL(configured)
  const port = Number(url.port || (url.protocol === 'https:' ? 443 : 80))
  const alternatives: Record<string, string> = { '127.0.0.1': '[::1]', '[::1]': '127.0.0.1' }
  const alternative = alternatives[url.hostname]
  const hosts = alternative ? [url.hostname, alternative] : [url.hostname]
  for (const host of hosts) {
    if (await accepts(host, port, timeoutMs)) {
      const reachable = new URL(configured)
      reachable.hostname = host
      return reachable.origin
    }
  }
  return null
}

/**
 * The Deno entry Studio writes next to the backend. It imports the backend
 * statically (no read permission needed), answers JSON-RPC over stdio, and
 * gives each call a Studio client that carries the call's capability token.
 * The backend's console output goes to stderr, so it cannot forge answers.
 */
function harnessSource (entry: string, endpoint: string): string {
  return String.raw`import * as app from ${JSON.stringify(`./${entry}`)}
const endpoint = ${JSON.stringify(endpoint)}
const encoder = new TextEncoder()
const stdout = Deno.stdout
let queue = Promise.resolve()
const write = message => (queue = queue.then(async () => {
  let data = encoder.encode(JSON.stringify(message) + '\n')
  while (data.length > 0) {
    data = data.subarray(await stdout.write(data))
  }
}))
for (const level of ['log', 'info', 'debug', 'warn']) console[level] = (...args) => console.error(...args)
// studio.connections.call carries bytes as base64 over HTTP (ADR 0047); backends see Uint8Arrays.
const toBase64 = bytes => {
  let text = ''
  for (let index = 0; index < bytes.length; index += 0x8000) text += String.fromCharCode(...bytes.subarray(index, index + 0x8000))
  return btoa(text)
}
const fromBase64 = base64 => Uint8Array.from(atob(base64), char => char.charCodeAt(0))
const isRecord = value => typeof value === 'object' && value !== null && !Array.isArray(value)
const binary = value => value instanceof Uint8Array ? value : (value instanceof ArrayBuffer ? new Uint8Array(value) : null)
const fileBytes = file => isRecord(file) ? binary(file.bytes) : null
// Only a binary body and the bytes of multipart file parts change; a JSON body with a files property passes as it is.
function encodeCall (params) {
  const body = params?.body
  const bytes = binary(body)
  if (bytes) return { ...params, body: toBase64(bytes), encoding: 'base64' }
  const files = isRecord(body) && isRecord(body.files) ? body.files : null
  if (!files || !Object.values(files).some(fileBytes)) return params
  const encoded = Object.fromEntries(Object.entries(files).map(([name, file]) => {
    const content = fileBytes(file)
    if (!content) return [name, file]
    const { bytes: _bytes, ...part } = file
    return [name, { ...part, base64: toBase64(content) }]
  }))
  return { ...params, body: { ...body, files: encoded } }
}
function decodeResult (result) {
  if (result?.encoding !== 'base64') return result
  const { encoding, ...rest } = result
  return { ...rest, body: fromBase64(rest.body) }
}
function studioFor (token) {
  return {
    async call (method, params) {
      const connections = method === 'studio.connections.call'
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
        body: JSON.stringify({ method, params: (connections ? encodeCall(params) : params) ?? {} }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) {
        const error = new Error(body.detail ?? body.title ?? 'Studio refused the call.')
        error.problem = body
        throw error
      }
      return connections ? decodeResult(body.result) : body.result
    },
  }
}
async function handle (line) {
  let message
  try { message = JSON.parse(line) } catch { return }
  const handler = Object.hasOwn(app, message.method) ? app[message.method] : undefined
  if (typeof handler !== 'function') {
    await write({ id: message.id, error: { code: 'method_not_found', message: 'The backend has no function ' + message.method + '.' } })
    return
  }
  try {
    // Settings and connection status for the call's target (ADR 0048).
    const result = await handler(message.params, { studio: studioFor(message.token), settings: message.context?.settings ?? {}, connections: message.context?.connections ?? {} })
    await write({ id: message.id, result: result ?? null })
  } catch (error) {
    await write({ id: message.id, error: { code: error?.problem?.code ?? 'error', message: String(error?.message ?? error).slice(0, 1000) } })
  }
}
await write({ type: 'ready' })
let buffer = ''
for await (const chunk of Deno.stdin.readable.pipeThrough(new TextDecoderStream())) {
  buffer += chunk
  let index
  while ((index = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, index)
    buffer = buffer.slice(index + 1)
    handle(line)
  }
}
`
}

interface Pending {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer: NodeJS.Timeout
}

class BackendProcess {
  readonly ready: Promise<void>
  #child: ChildProcessWithoutNullStreams
  #pending = new Map<number, Pending>()
  #nextId = 1
  #stdout = ''
  #exited = false
  #killed = false

  constructor (
    child: ChildProcessWithoutNullStreams,
    private readonly appId: string,
    private readonly options: Required<BackendRunnerOptions>,
    onExit: () => void,
  ) {
    this.#child = child
    let markReady: () => void
    let failStart: (error: Error) => void
    this.ready = new Promise<void>((resolve, reject) => {
      markReady = resolve
      failStart = reject
    })
    const startup = setTimeout(() => {
      failStart(new StudioProblem('app_backend_unavailable', 'The backend did not start in time.'))
      this.kill()
    }, options.startupTimeoutMs)

    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      this.#stdout += chunk
      if (this.#stdout.length > options.maxMessageBytes) {
        this.#failAll('The backend sent an answer that is too large.')
        this.kill()
        return
      }
      let index
      while ((index = this.#stdout.indexOf('\n')) >= 0) {
        const line = this.#stdout.slice(0, index)
        this.#stdout = this.#stdout.slice(index + 1)
        let message: { type?: string, id?: number, result?: unknown, error?: { code?: string, message?: string } }
        try {
          message = JSON.parse(line)
        } catch {
          continue
        }
        if (message.type === 'ready') {
          clearTimeout(startup)
          markReady!()
          continue
        }
        const pending = typeof message.id === 'number' ? this.#pending.get(message.id) : undefined
        if (!pending) {
          continue
        }
        this.#pending.delete(message.id!)
        clearTimeout(pending.timer)
        if (message.error) {
          pending.reject(new StudioProblem('app_backend_failed', `${message.error.message ?? 'The backend failed.'}`.slice(0, 1000)))
        } else {
          pending.resolve(message.result ?? null)
        }
      }
    })

    // App logs are untrusted: bounded, tagged, and kept apart from audit records.
    let logged = 0
    const logWindow = setInterval(() => {
      logged = 0
    }, 60_000)
    logWindow.unref()
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => {
      for (const line of chunk.split('\n').filter(Boolean)) {
        if (logged++ < 100) {
          console.info(`[app ${this.appId}] ${line.slice(0, 500)}`)
        }
      }
    })

    child.on('exit', () => {
      this.#exited = true
      clearTimeout(startup)
      clearInterval(logWindow)
      failStart!(new StudioProblem('app_backend_unavailable', 'The backend exited during startup.'))
      this.#failAll('The backend process exited.')
      onExit()
    })
    child.on('error', () => {
      failStart!(new StudioProblem('app_backend_unavailable', 'The backend process could not be started.'))
      this.#failAll('The backend process could not be started.')
    })
    // Writing to a process that just died fails asynchronously (EPIPE); the
    // exit handler already fails its calls, and the service must not crash.
    child.stdin.on('error', () => {})
  }

  get pid (): number | undefined {
    return this.#child.pid
  }

  /** Exited, or killed and about to exit: no longer accepts calls. */
  get exited (): boolean {
    return this.#exited || this.#killed
  }

  call (method: string, params: unknown, token: string, context: BackendCallContext): Promise<unknown> {
    const id = this.#nextId++
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id)
        reject(new StudioProblem('app_backend_unavailable', `The backend did not answer within ${Math.round(this.options.callTimeoutMs / 1000)} s and was stopped.`))
        this.kill()
      }, this.options.callTimeoutMs)
      this.#pending.set(id, { resolve, reject, timer })
      this.#child.stdin.write(`${JSON.stringify({ id, method, params: params ?? null, token, context })}\n`)
    })
  }

  kill (): void {
    if (!this.#exited && !this.#killed) {
      this.#killed = true
      this.#child.kill('SIGKILL')
    }
  }

  #failAll (detail: string) {
    for (const [id, pending] of this.#pending) {
      clearTimeout(pending.timer)
      pending.reject(new StudioProblem('app_backend_unavailable', detail))
      this.#pending.delete(id)
    }
  }
}

/**
 * Runs backend apps in Deno with deny-by-default permissions (ADR 0019): one
 * process per installation, started on demand, stopped when idle or
 * uninstalled, and killed when a call exceeds its time limit. A crash
 * affects only that backend; the next call starts it again.
 */
export class BackendRunner {
  readonly #options: Required<BackendRunnerOptions>
  #processes = new Map<string, { process: BackendProcess, idle: NodeJS.Timeout | undefined }>()
  #starting = new Map<string, Promise<BackendProcess>>()
  /** Advanced by `stop`, so a start that began before it neither runs nor stays cached. */
  #generations = new Map<string, number>()
  #capabilityUrl: string | undefined

  constructor (options: BackendRunnerOptions) {
    this.#options = {
      callTimeoutMs: 30_000,
      startupTimeoutMs: 10_000,
      idleTimeoutMs: 5 * 60_000,
      memoryMb: 256,
      maxMessageBytes: 16 * 1024 * 1024,
      callPath: '/api/studio/v1/app-calls',
      ...options,
    }
  }

  /** The process ID of a running backend, for supervision and tests. */
  pid (installationId: string): number | undefined {
    return this.#processes.get(installationId)?.process.pid
  }

  async call (installationId: string, load: () => Promise<BackendSource>, method: string, params: unknown, token: string, context?: BackendCallContext): Promise<unknown> {
    const process = await this.#ensure(installationId, load)
    this.#touch(installationId)
    return process.call(method, params, token, context ?? { settings: {}, connections: {} })
  }

  /**
   * Stops the backend and removes its extracted files. A start in progress
   * is abandoned: the next call starts the backend again, with the files the
   * loader then returns (e.g. after an update in place).
   */
  async stop (installationId: string): Promise<void> {
    this.#generations.set(installationId, this.#generation(installationId) + 1)
    this.#starting.delete(installationId)
    const entry = this.#processes.get(installationId)
    this.#processes.delete(installationId)
    if (entry) {
      clearTimeout(entry.idle)
      entry.process.kill()
    }
    await rm(this.#directory(installationId), { recursive: true, force: true })
  }

  dispose (): void {
    for (const [installationId, entry] of this.#processes) {
      clearTimeout(entry.idle)
      entry.process.kill()
      this.#processes.delete(installationId)
    }
  }

  #generation (installationId: string): number {
    return this.#generations.get(installationId) ?? 0
  }

  #directory (installationId: string): string {
    return join(this.#options.workDir, installationId)
  }

  #touch (installationId: string) {
    const entry = this.#processes.get(installationId)
    if (!entry) {
      return
    }
    clearTimeout(entry.idle)
    entry.idle = setTimeout(() => void this.stop(installationId), this.#options.idleTimeoutMs)
    entry.idle.unref()
  }

  async #ensure (installationId: string, load: () => Promise<BackendSource>): Promise<BackendProcess> {
    const running = this.#processes.get(installationId)
    if (running && !running.process.exited) {
      return running.process
    }
    let starting = this.#starting.get(installationId)
    if (!starting) {
      const started: Promise<BackendProcess> = this.#start(installationId, this.#generation(installationId), load).finally(() => {
        // A stop may have replaced this start with a newer one meanwhile.
        if (this.#starting.get(installationId) === started) {
          this.#starting.delete(installationId)
        }
      })
      starting = started
      this.#starting.set(installationId, starting)
    }
    return starting
  }

  /** The capability URL that answers, found once; until one answers, the configured one. */
  async #reachableCapabilityUrl (): Promise<string> {
    this.#capabilityUrl ??= await reachableLoopbackUrl(this.#options.capabilityUrl) ?? undefined
    return this.#capabilityUrl ?? this.#options.capabilityUrl
  }

  async #start (installationId: string, generation: number, load: () => Promise<BackendSource>): Promise<BackendProcess> {
    if (!existsSync(this.#options.denoPath)) {
      throw new StudioProblem('app_backend_unavailable', 'The Deno runtime for backend apps is not installed.')
    }
    const stopped = () => new StudioProblem('app_backend_unavailable', 'The backend was stopped while it started, e.g. by an update of the app.')
    const source = await load()
    // Each start has its own directory, so an abandoned one cannot write into the next.
    const directory = join(this.#directory(installationId), String(generation))
    if (this.#generation(installationId) !== generation) {
      throw stopped()
    }
    await rm(directory, { recursive: true, force: true })
    for (const [path, content] of source.files) {
      const file = join(directory, path)
      await mkdir(dirname(file), { recursive: true })
      await writeFile(file, content)
    }
    const capabilityUrl = await this.#reachableCapabilityUrl()
    const endpoint = `${capabilityUrl}${this.#options.callPath}`
    await writeFile(join(directory, harnessFile), harnessSource(source.entry, endpoint))
    if (this.#generation(installationId) !== generation) {
      await rm(directory, { recursive: true, force: true })
      throw stopped()
    }

    const child = spawn(this.#options.denoPath, [
      'run',
      '--no-prompt',
      '--no-remote',
      '--no-npm',
      '--no-config',
      '--no-lock',
      '--cached-only',
      `--allow-net=${new URL(capabilityUrl).host}`,
      `--v8-flags=--max-old-space-size=${this.#options.memoryMb}`,
      harnessFile,
    ], {
      cwd: directory,
      // Nothing from Studio's environment (it holds the data key).
      env: {
        DENO_DIR: join(this.#options.workDir, '.deno'),
        DENO_NO_UPDATE_CHECK: '1',
        NO_COLOR: '1',
        ...(process.platform === 'win32' ? { SystemRoot: process.env.SystemRoot ?? String.raw`C:\Windows` } : {}),
      },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    })
    const backend = new BackendProcess(child, source.appId, this.#options, () => {
      const entry = this.#processes.get(installationId)
      if (entry?.process === backend) {
        clearTimeout(entry.idle)
        this.#processes.delete(installationId)
      }
    })
    this.#processes.set(installationId, { process: backend, idle: undefined })
    await backend.ready
    if (this.#generation(installationId) !== generation) {
      // Stopped while it started: stop removed the cached entry already.
      backend.kill()
      throw stopped()
    }
    return backend
  }
}
