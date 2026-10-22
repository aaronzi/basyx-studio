import type { StudioClient } from '@basyx/studio-sdk'
import type { HistoryState, RouterHistory } from 'vue-router'

// A Vue Router history over a module's sub-path (ADR 0045): the module's
// pages are routes, and Studio's URL carries the route as the module's
// sub-path, so links to a page work and Studio's own navigation reaches the
// router. Without a runtime import of vue-router, which the app brings.

type NavigationCallback = Parameters<RouterHistory['listen']>[0]
type NavigationInformation = Parameters<NavigationCallback>[2]

/** How long a move Studio took waits for its context before the next one is sent anyway. */
const confirmationTimeoutMs = 2000

interface Entry {
  location: string
  state: HistoryState
}

/** `/shells/abc?x=1#y` → `shells/abc`. */
function subPathOf (location: string): string {
  return location.split(/[?#]/, 1)[0]!.replace(/^\/+/, '').replace(/\/+$/, '')
}

export interface StudioHistoryOptions {
  /** How a route change reaches the browser's history: `replace` (default) or `push`. */
  history?: 'push' | 'replace'
}

/**
 * A Vue Router history for a module whose pages are routes:
 *
 *   const router = createRouter({ history: createStudioHistory(client), routes })
 *
 * Route changes call `client.ui.navigate` with the route's path as the
 * module's sub-path (`/shells/abc` → `shells/abc`); a changed sub-path in
 * Studio's context, e.g. after a link to one of the module's pages, moves
 * the router. Studio's sub-paths are path segments of letters, digits and
 * `-._~`, so keep routes to those (encode IDs, e.g. as base64url); query
 * and hash stay in the frame and are not part of Studio's URL.
 *
 * By default Studio replaces its history entry, so the browser's back
 * button leaves the module. With `{ history: 'push' }` (Studio app API
 * 0.1.8, so the manifest declares `"studioApi": "^0.1.8"`), each new page
 * is a history entry: back and forward move between the module's pages,
 * and the router follows. A sandboxed frame cannot move the browser's
 * history itself, so `router.back()` and `router.go()` move through the
 * pages this history visited and replace Studio's entry with that page.
 */
export function createStudioHistory (client: StudioClient, options: StudioHistoryOptions = {}): RouterHistory {
  const listeners = new Set<NavigationCallback>()
  const entries: Entry[] = [{ location: `/${client.context.subPath}`, state: {} }]
  let position = 0
  // Studio gets one move at a time: its router cancels a move that a later
  // one overtakes, so the contexts of rapid moves could not be told from a
  // move of Studio's own. While one is pending, only the latest page counts.
  /** The sub-path sent to Studio whose context has not come back yet. */
  let pending: string | null = null
  /** The page the router moved to while a move was pending, sent once Studio is there. */
  let next: { subPath: string, push: boolean } | null = null
  let timeout: ReturnType<typeof setTimeout> | undefined

  const current = () => entries[position]!

  /** Moves Studio to a location; `push` adds a history entry where the options allow it. */
  function send (location: string, push = false) {
    const subPath = subPathOf(location)
    if (pending !== null) {
      next = { subPath, push: push || (next?.push ?? false) }
      return
    }
    if (subPath === client.context.subPath) {
      return
    }
    pending = subPath
    // Without options for `replace`, so a Studio before app API 0.1.8 takes the call too.
    const navigation = push && options.history === 'push' ? client.ui.navigate(subPath, { history: 'push' }) : client.ui.navigate(subPath)
    navigation.then(() => {
      // Should Studio's context not follow, e.g. because its own navigation was aborted, go on.
      if (pending === subPath) {
        timeout = setTimeout(() => settle(subPath), confirmationTimeoutMs)
      }
    }, (error: unknown) => {
      console.error(`Studio refused the sub-path ${JSON.stringify(subPath)}:`, error)
      settle(subPath)
    })
  }

  /** Studio is done with a move: it gets the latest page the router moved to meanwhile. */
  function settle (subPath: string) {
    if (pending !== subPath) {
      return
    }
    clearTimeout(timeout)
    pending = null
    const queued = next
    next = null
    if (queued) {
      send(`/${queued.subPath}`, queued.push)
    }
  }

  /** Tells the router the page changed without it; `direction` is `''` where it is unknown. */
  function notify (from: string, delta: number, direction: 'back' | 'forward' | '') {
    const information = { type: 'pop', direction, delta } as unknown as NavigationInformation
    for (const listener of listeners) {
      listener(current().location, from, information)
    }
  }

  const stop = client.onContext(context => {
    const { subPath } = context
    if (pending !== null) {
      // The answer to the router's move: the router is there, or further on.
      if (subPath === pending) {
        settle(subPath)
        return
      }
      // Studio moved on its own before it answered, which cancels the router's move.
      clearTimeout(timeout)
      pending = null
      next = null
    }
    if (subPath === subPathOf(current().location)) {
      return
    }
    const from = current().location
    // Studio moved on its own: to a page next to this one, or to a new one.
    if (position > 0 && subPathOf(entries[position - 1]!.location) === subPath) {
      position--
      notify(from, -1, 'back')
    } else if (position < entries.length - 1 && subPathOf(entries[position + 1]!.location) === subPath) {
      position++
      notify(from, 1, 'forward')
    } else {
      entries.splice(position + 1, Infinity, { location: `/${subPath}`, state: {} })
      position++
      notify(from, 0, '')
    }
  })

  return {
    base: '',
    get location () {
      return current().location
    },
    get state () {
      return current().state
    },
    push (to, data) {
      entries.splice(position + 1, Infinity, { location: to, state: data ?? {} })
      position++
      send(to, true)
    },
    replace (to, data) {
      entries[position] = { location: to, state: data ?? {} }
      send(to)
    },
    go (delta, triggerListeners = true) {
      const target = Math.min(Math.max(position + delta, 0), entries.length - 1)
      if (target === position) {
        return
      }
      const from = current().location
      const moved = target - position
      position = target
      send(current().location)
      if (triggerListeners) {
        notify(from, moved, moved < 0 ? 'back' : 'forward')
      }
    },
    listen (callback) {
      listeners.add(callback)
      return () => {
        listeners.delete(callback)
      }
    },
    // Links in the frame are handled by the router; Studio's URL is not the frame's.
    createHref: to => `#${to}`,
    destroy () {
      clearTimeout(timeout)
      stop()
      listeners.clear()
    },
  }
}
