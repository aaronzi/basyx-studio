import type { AppContext, HostMessage, Problem, RequestMessage } from './protocol.ts'

/** A capability call that Studio refused or that failed. */
export class StudioError extends Error {
  readonly problem: Problem

  constructor (problem: Problem, options?: ErrorOptions) {
    super(problem.detail ?? problem.title, options)
    this.name = 'StudioError'
    this.problem = problem
  }

  get code (): string {
    return this.problem.code
  }
}

/**
 * How a `StudioClient` reaches Studio. In a frame it is the MessagePort of
 * `studio-sdk/0` (`connect()`); in a dev server or a unit test it is the
 * in-memory transport of `@basyx/studio-sdk/testing`.
 */
export interface Transport {
  /** Sends a capability call. Rejects with a `StudioError` when Studio refuses it or it fails. */
  call: (method: string, params: unknown) => Promise<unknown>
  /** Called with every context Studio sends after the first. Returns an unsubscribe function. */
  onContext: (listener: (context: AppContext) => void) => () => void
  /** Ends the connection; pending calls are rejected. */
  close: () => void
}

/** The transport of `studio-sdk/0` over the port that Studio transferred with `connect`. */
export function portTransport (port: MessagePort): Transport {
  let nextId = 1
  let closed = false
  const pending = new Map<number, { resolve: (value: unknown) => void, reject: (error: Error) => void }>()
  const listeners = new Set<(context: AppContext) => void>()

  port.addEventListener('message', event => {
    const message = event.data as HostMessage
    if (message.type === 'context') {
      for (const listener of listeners) {
        listener(message.context)
      }
      return
    }
    const entry = pending.get(message.id)
    if (!entry) {
      return
    }
    pending.delete(message.id)
    if (message.type === 'response') {
      entry.resolve(message.result)
    } else {
      entry.reject(new StudioError(message.problem))
    }
  })
  port.start()

  return {
    call (method, params) {
      if (closed) {
        return Promise.reject(new Error('The connection to BaSyx Studio is closed.'))
      }
      const id = nextId++
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject })
        const request: RequestMessage = { type: 'request', id, method, params }
        port.postMessage(request)
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
      port.close()
      for (const entry of pending.values()) {
        entry.reject(new Error('The connection to BaSyx Studio was closed.'))
      }
      pending.clear()
      listeners.clear()
    },
  }
}
