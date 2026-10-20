import type { AppContext, MethodName, Methods, Permission, Problem, ThemeTokens } from './protocol.ts'
import type { Transport } from './transport.ts'
import { StudioClient } from './index.ts'
import { methodPermissions, protocolVersion } from './protocol.ts'
import { StudioError } from './transport.ts'

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

/** A handler of one method. Throw a `StudioError` (see `studioError`) to refuse the call. */
export type TestHandler<M extends MethodName> = (params: Methods[M]['params'], studio: TestStudio) => Methods[M]['result'] | Promise<Methods[M]['result']>

export type TestHandlers = { [M in MethodName]?: TestHandler<M> }

export interface TestStudioOptions {
  /** Replaces parts of the default context (see `testContext`). */
  context?: Partial<AppContext>
  /** Handlers by method; they replace the built-in ones for the same method. */
  handlers?: TestHandlers
  /**
   * The app's declared permissions. When given, a call whose method needs
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

export interface TestStudio {
  /** The client to hand to the app, as `connect()` would return it. */
  readonly client: StudioClient
  /** The context the app last received. */
  readonly context: AppContext
  /** Every call the app made, in order, including refused ones. */
  readonly calls: TestCall[]
  /** What the app showed with `studio.ui.notify`. */
  readonly notifications: TestNotification[]
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
 * and Studio's light theme.
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
    viewState: '',
    locale: 'en',
    theme: testTheme(),
    ...patch,
  }
}

const problemTitles: Record<string, { status: number, title: string }> = {
  invalid_request: { status: 400, title: 'Invalid request' },
  forbidden: { status: 403, title: 'Not permitted' },
  not_found: { status: 404, title: 'Not found' },
  unsupported_operation: { status: 422, title: 'This operation is not supported here' },
  app_permission_not_declared: { status: 403, title: 'The app did not declare the permission for this call' },
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

/** Creates a Studio in memory with a connected client. */
export function createTestStudio (options: TestStudioOptions = {}): TestStudio {
  let context = testContext(options.context)
  let closed = false
  const calls: TestCall[] = []
  const notifications: TestNotification[] = []
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
    'studio.ui.navigate': ({ subPath }) => {
      setContext({ subPath })
      return null
    },
    'studio.ui.notify': ({ message, level }) => {
      notifications.push({ message, level: level ?? 'info' })
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
    if (options.permissions && permission && !options.permissions.includes(permission)) {
      throw studioError('app_permission_not_declared', `${method} needs the permission ${permission}, which ${context.appId} did not declare.`)
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

  const studio: TestStudio = {
    client: new StudioClient(transport, structuredClone(context)),
    get context () {
      return context
    },
    calls,
    notifications,
    setContext,
    close: () => transport.close(),
  }
  return studio
}
