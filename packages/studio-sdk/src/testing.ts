import type { AppContext, AppSettingValue, ConnectionCallParams, ConnectionCallResult, MethodName, Methods, Permission, Problem, ThemeTokens } from './protocol.ts'
import type { Transport } from './transport.ts'
import { StudioClient } from './index.ts'
import { editModeMethods, permissions as knownPermissions, methodPermissions, protocolVersion, putAttachmentMaxBytes } from './protocol.ts'
import { StudioError } from './transport.ts'

export { memoryAas } from './memory-aas.ts'
export type { MemoryAas, MemoryAasOptions } from './memory-aas.ts'

// An in-memory Studio for running an app's UI in a plain dev server and for
// unit tests (MVP-7 D2, ADR 0043). It answers the UI methods that Studio's
// page answers; everything else comes from the caller's handlers, so the
// app's data are fixtures the caller owns.
//
//   const studio = createTestStudio({
//     handlers: {
//       'studio.aas.listShells': () => ({ items: shells, page: { nextCursor: null, hasMore: false } }),
//     },
//   })
//   await mountApp(App, components, { client: studio.client })
//
// `memoryAas()` provides handlers for the AAS methods, including structural
// writes and attachments, over shells and submodels the caller passes.

/** A handler of one method. Throw a `StudioError` (see `studioError`) to refuse the call. */
export type TestHandler<M extends MethodName> = (params: Methods[M]['params'], studio: TestStudio) => Methods[M]['result'] | Promise<Methods[M]['result']>

export type TestHandlers = { [M in MethodName]?: TestHandler<M> }

/**
 * The parts of an app manifest the test Studio reads, typed as a manifest
 * imported from JSON is (`permissions: string[]`), so it needs no cast:
 * `import manifest from '../studio-app.json'`.
 */
export interface TestManifest {
  id: string
  permissions: readonly string[]
  connections?: readonly { id: string, operations: readonly string[] }[]
  settings?: readonly { key: string, default?: unknown }[]
  contributes?: {
    modules?: readonly { id: string }[]
    submodelViews?: readonly { id: string }[]
  }
}

export interface TestStudioOptions {
  /** Replaces parts of the default context (see `testContext`). */
  context?: Partial<AppContext>
  /** Handlers by method; they replace the built-in ones for the same method. */
  handlers?: TestHandlers
  /**
   * The app's manifest. Calls are checked against its permissions and its
   * connections' operations as Studio checks them, and the context names
   * its ID and its first module (or submodel view), has its settings'
   * defaults and its connections bound. A permission Studio does not know
   * fails `createTestStudio`.
   */
  manifest?: TestManifest
  /**
   * The app's declared permissions, or with `manifest` some of them, e.g.
   * to test how the app behaves without one. A call whose method needs
   * another permission is refused as Studio refuses it.
   */
  permissions?: readonly Permission[]
}

export interface TestCall {
  method: MethodName
  params: unknown
}

export interface TestNotification {
  message: string
  level: NonNullable<Methods['studio.ui.notify']['params']['level']>
}

export type TestOpenedShell = Methods['studio.ui.openShell']['params']

export interface TestNavigation {
  subPath: string
  history: NonNullable<Methods['studio.ui.navigate']['params']['history']>
}

export interface TestStudio {
  /** The client to hand to the app, as `connect()` would return it. */
  readonly client: StudioClient
  /** The context the app last received. */
  readonly context: AppContext
  /** Every call the app made, in order, including refused ones. */
  readonly calls: TestCall[]
  /** What the app showed with `studio.ui.notify`. */
  readonly notifications: TestNotification[]
  /** The shells the app opened with `studio.ui.openShell`, where Studio would have left the app's page. */
  readonly openedShells: TestOpenedShell[]
  /** Every `studio.ui.navigate` call, with the history mode Studio applied. */
  readonly navigations: TestNavigation[]
  /**
   * Moves through the sub-paths that `navigate` pushed, as the browser's back
   * and forward buttons do, and sends the context; `false` at either end.
   */
  back: () => boolean
  forward: () => boolean
  /** Sends a changed context to the app, as Studio does when the theme, the sub-path or the target changes. */
  setContext: (patch: Partial<AppContext>) => void
  /** Ends the connection; later calls are rejected. */
  close: () => void
}

/** Studio's BaSyx accent in light and dark mode, as Studio sends it with the default settings. */
export function testTheme (dark = false): ThemeTokens {
  return dark
    ? { dark, colors: { 'primary': '#00ADEE', 'secondary': '#F69222', 'background': '#121212', 'surface': '#212121', 'on-primary': '#000000' } }
    : { dark, colors: { 'primary': '#0077A6', 'secondary': '#A65400', 'background': '#FFFFFF', 'surface': '#FFFFFF', 'on-primary': '#FFFFFF' } }
}

/**
 * A context with `patch` applied: a module (`main`) on a writable target
 * named "Test target", without shell or submodel, in view mode, in English
 * and Studio's light theme, without settings or connections. Pass the app's
 * settings and connection status as `settings` and `connections`.
 */
export function testContext (patch: Partial<AppContext> = {}): AppContext {
  return {
    protocol: protocolVersion,
    installationId: 'test-installation',
    appId: 'org.example.test',
    contribution: { kind: 'module', id: 'main' },
    target: { id: 'test-target', name: 'Test target', write: true, persistence: 'immediate' },
    shell: null,
    submodel: null,
    subPath: '',
    mode: 'view',
    fullscreen: false,
    fullscreenOpen: false,
    viewState: '',
    locale: 'en',
    theme: testTheme(),
    settings: {},
    connections: {},
    ...patch,
  }
}

const problemTitles: Record<string, { status: number, title: string }> = {
  invalid_request: { status: 400, title: 'Invalid request' },
  forbidden: { status: 403, title: 'Not permitted' },
  not_found: { status: 404, title: 'Not found' },
  unsupported_operation: { status: 422, title: 'This operation is not supported here' },
  app_permission_not_declared: { status: 403, title: 'The app did not declare the permission for this call' },
  app_edit_mode_required: { status: 403, title: 'Switch to edit mode to change content from an app' },
  connection_not_bound: { status: 403, title: 'The app\'s connection is not bound to a connection of this infrastructure' },
  connection_operation_not_declared: { status: 403, title: 'The app did not declare this connection or operation' },
  internal_error: { status: 500, title: 'Internal error' },
}

/** A refusal in Studio's problem shape, for handlers to throw: `throw studioError('not_found', 'No such shell.')`. */
export function studioError (code: string, detail?: string, status?: number): StudioError {
  const known = problemTitles[code]
  const problem: Problem = {
    code,
    title: known?.title ?? code,
    status: status ?? known?.status ?? 400,
    retryable: code === 'internal_error',
  }
  if (detail !== undefined) {
    problem.detail = detail
  }
  return new StudioError(problem)
}

/** One operation of a test service: the call's parameters in, the parts of the answer that differ from the defaults out. */
export type TestOperation = (request: Omit<ConnectionCallParams, 'connection' | 'operation'>, studio: TestStudio) => Partial<ConnectionCallResult> | Promise<Partial<ConnectionCallResult>>

/** The default media type of a test answer's body. */
function contentTypeOf (body: unknown): string | null {
  if (body === null || body === undefined) {
    return null
  }
  if (typeof body === 'string') {
    return 'text/plain; charset=utf-8'
  }
  return body instanceof Uint8Array ? 'application/octet-stream' : 'application/json'
}

/**
 * A handler of `studio.connections.call` that answers with test services:
 * functions per connection ID and `operationId`, as the app's manifest
 * declares them. A connection without functions is refused as an unbound one
 * is (`connection_not_bound`), an operation without a function as an
 * undeclared one (`connection_operation_not_declared`). So is a connection
 * that the context marks `{ bound: false }`. Answers default to status 200
 * with the body's media type and no `etag` or `location`.
 *
 *   handlers: {
 *     'studio.connections.call': connectionsHandler({
 *       forecast: { getForecast: ({ path }) => ({ body: { station: path?.station, days: [] } }) },
 *     }),
 *   }
 */
export function connectionsHandler (connections: Record<string, Record<string, TestOperation>>): TestHandler<'studio.connections.call'> {
  return async ({ connection, operation, ...request }, studio) => {
    const operations = Object.hasOwn(connections, connection) ? connections[connection]! : undefined
    if (!operations || studio.context.connections?.[connection]?.bound === false) {
      throw studioError('connection_not_bound', `No connection of the target's infrastructure is bound to ${connection}.`)
    }
    const handler = Object.hasOwn(operations, operation) ? operations[operation] : undefined
    if (!handler) {
      throw studioError('connection_operation_not_declared', `The connection ${connection} has no operation ${operation}.`)
    }
    const answer = await handler(request, studio)
    const body = answer.body ?? null
    return {
      status: answer.status ?? 200,
      contentType: answer.contentType === undefined ? contentTypeOf(body) : answer.contentType,
      etag: answer.etag ?? null,
      location: answer.location ?? null,
      body,
    }
  }
}

/** The permissions a manifest declares; throws for one Studio does not know, as Studio's upload refuses it. */
function permissionsOf (manifest: TestManifest, narrowed: readonly Permission[] | undefined): readonly Permission[] {
  const unknown = manifest.permissions.filter(permission => !(knownPermissions as readonly string[]).includes(permission))
  if (unknown.length > 0) {
    throw new Error(`The manifest of ${manifest.id} declares permissions Studio does not know: ${unknown.join(', ')}.`)
  }
  const declared = manifest.permissions as readonly Permission[]
  const undeclared = narrowed?.filter(permission => !declared.includes(permission)) ?? []
  if (undeclared.length > 0) {
    throw new Error(`permissions names ${undeclared.join(', ')}, which the manifest of ${manifest.id} does not declare.`)
  }
  return narrowed ?? declared
}

/**
 * The context's app and contribution from a manifest: its first module, else
 * its first submodel view. Its settings have their defaults, as on an
 * infrastructure without values (ADR 0048), and its connections are bound.
 */
function manifestContext (manifest: TestManifest): Partial<AppContext> {
  const declared = {
    appId: manifest.id,
    settings: Object.fromEntries((manifest.settings ?? []).map(setting => [setting.key, (setting.default ?? null) as AppSettingValue | null])),
    connections: Object.fromEntries((manifest.connections ?? []).map(connection => [connection.id, { bound: true }])),
  }
  const module = manifest.contributes?.modules?.[0]
  if (module) {
    return { ...declared, contribution: { kind: 'module', id: module.id } }
  }
  const view = manifest.contributes?.submodelViews?.[0]
  return { ...declared, ...(view ? { contribution: { kind: 'submodelView', id: view.id } } : {}) }
}

/** Refuses a connection call the manifest does not declare, before any handler, as Studio does. */
function checkConnectionCall (manifest: TestManifest, { connection, operation }: ConnectionCallParams): void {
  const declared = manifest.connections?.find(item => item.id === connection)
  if (!declared) {
    throw studioError('connection_operation_not_declared', `${manifest.id} declares no connection ${connection}.`)
  }
  if (!declared.operations.includes(operation)) {
    throw studioError('connection_operation_not_declared', `${manifest.id} does not declare the operation ${operation} of its connection ${connection}.`)
  }
}

/** Creates a Studio in memory with a connected client. */
export function createTestStudio (options: TestStudioOptions = {}): TestStudio {
  const { manifest } = options
  const permissions = manifest ? permissionsOf(manifest, options.permissions) : options.permissions
  let context = testContext({ ...(manifest ? manifestContext(manifest) : {}), ...options.context })
  let closed = false
  const calls: TestCall[] = []
  const notifications: TestNotification[] = []
  const openedShells: TestOpenedShell[] = []
  const navigations: TestNavigation[] = []
  // The browser's history of the module's sub-paths.
  const entries = [context.subPath]
  let entry = 0
  const listeners = new Set<(context: AppContext) => void>()

  const setContext = (patch: Partial<AppContext>) => {
    context = { ...context, ...patch }
    for (const listener of listeners) {
      listener(structuredClone(context))
    }
  }

  const builtIn: TestHandlers = {
    'studio.ui.getContext': () => context,
    'studio.ui.setHeight': () => null,
    'studio.ui.navigate': ({ subPath, history = 'replace' }) => {
      navigations.push({ subPath, history })
      if (history === 'push' && subPath !== entries[entry]) {
        entries.splice(++entry, Infinity, subPath)
      } else {
        entries[entry] = subPath
      }
      setContext({ subPath })
      return null
    },
    'studio.ui.notify': ({ message, level }) => {
      notifications.push({ message, level: level ?? 'info' })
      return null
    },
    'studio.ui.openShell': shell => {
      openedShells.push(shell)
      return null
    },
  }
  const handlers: TestHandlers = { ...builtIn, ...options.handlers }

  async function answer (method: string, params: unknown): Promise<unknown> {
    if (!Object.hasOwn(methodPermissions, method)) {
      throw studioError('invalid_request', `${method} is not a Studio app method.`)
    }
    const name = method as MethodName
    const permission = methodPermissions[name]
    if (permissions && permission && !permissions.includes(permission)) {
      throw studioError('app_permission_not_declared', `${method} needs the permission ${permission}, which ${context.appId} did not declare.`)
    }
    // Studio's server refuses these outside edit mode, whatever the app shows.
    if (editModeMethods.includes(name) && context.mode !== 'edit') {
      throw studioError('app_edit_mode_required', `${method} needs Studio's edit mode.`)
    }
    if (manifest && name === 'studio.connections.call') {
      checkConnectionCall(manifest, params as ConnectionCallParams)
    }
    if (name === 'studio.aas.putAttachment') {
      const { data } = params as Methods['studio.aas.putAttachment']['params']
      if (!(data instanceof ArrayBuffer || ArrayBuffer.isView(data)) || data.byteLength === 0 || data.byteLength > putAttachmentMaxBytes) {
        throw studioError('invalid_request', `The attachment must be an ArrayBuffer or Uint8Array of 1 byte to ${putAttachmentMaxBytes / 1024 / 1024} MiB.`)
      }
    }
    const handler = handlers[name] as TestHandler<MethodName> | undefined
    if (!handler) {
      throw studioError('unsupported_operation', `The test Studio has no handler for ${method}.`)
    }
    return handler(params as Methods[MethodName]['params'], studio)
  }

  // The answer as it crosses a MessagePort: a structured clone, or the
  // refusal in Studio's problem shape.
  async function respond (method: string, params: unknown): Promise<unknown> {
    await Promise.resolve()
    try {
      return structuredClone(await answer(method, params))
    } catch (error) {
      if (error instanceof StudioError) {
        throw new StudioError(structuredClone(error.problem))
      }
      const detail = error instanceof Error ? error.message : String(error)
      throw new StudioError({ code: 'internal_error', title: 'Internal error', status: 500, detail, retryable: true }, { cause: error })
    }
  }

  // Calls whose handler has not finished; `close()` rejects them, as the
  // port transport does, and their handlers' results are ignored.
  const pending = new Set<(error: Error) => void>()

  const transport: Transport = {
    call (method, params) {
      if (closed) {
        return Promise.reject(new Error('The connection to BaSyx Studio is closed.'))
      }
      // Values cross a MessagePort as structured clones, never as shared objects.
      let copy: unknown
      try {
        copy = structuredClone(params)
      } catch (error) {
        return Promise.reject(error)
      }
      calls.push({ method: method as MethodName, params: copy })
      return new Promise((resolve, reject) => {
        pending.add(reject)
        respond(method, copy).then(resolve, reject).finally(() => pending.delete(reject))
      })
    },
    onContext (listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    close () {
      closed = true
      for (const reject of pending) {
        reject(new Error('The connection to BaSyx Studio was closed.'))
      }
      pending.clear()
      listeners.clear()
    },
  }

  function go (delta: -1 | 1): boolean {
    if (entries[entry + delta] === undefined) {
      return false
    }
    entry += delta
    setContext({ subPath: entries[entry]! })
    return true
  }

  const studio: TestStudio = {
    client: new StudioClient(transport, structuredClone(context)),
    get context () {
      return context
    },
    calls,
    notifications,
    openedShells,
    navigations,
    back: () => go(-1),
    forward: () => go(1),
    setContext,
    close: () => transport.close(),
  }
  return studio
}
