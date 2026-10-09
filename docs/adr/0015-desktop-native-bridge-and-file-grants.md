# 0015: Desktop native bridge and file grants

- Status: Accepted
- Date: 2026-10-08
- Deciders: BaSyx Studio maintainers
- Requirements: DATA-005, SEC-009, UX-005

## Context

Opening and saving local packages needs native file dialogs, which only the
Electron main process can show. The sandboxed renderer must not see or choose
native paths, and the Studio Service must not accept paths from the renderer.

## Decision

- The preload exposes exactly two calls to the renderer: `chooseAasxFile` and
  `chooseSaveLocation`. They are answered only for the Studio page in the main
  frame of a Studio window.
- After the user picks a file, the main process registers the path with the
  Studio Service (`POST /desktop/file-grants`) and returns the resulting
  opaque, single-use handle (valid for five minutes) to the renderer.
- The grant endpoint is authenticated with a broker secret that only the main
  process and the service know. The renderer's requests carry the launch
  secret, never the broker secret. In `nuxt dev`, a local module shares the
  broker secret through the environment.
- Before a window closes, the main process asks the service for unsaved
  workspaces (`GET /desktop/state`) and asks the user. A cancelled close also
  cancels a running quit; a confirmed close resumes it.

## Consequences

- A compromised renderer can open dialogs but cannot read or write files the
  user did not pick.
- Granted paths are limited to `.aasx` files (existing for open, in an existing
  folder for save).
- The main process depends on the service being reachable to protect unsaved
  work; if it is not, the window closes.

## Alternatives considered

- **Sending paths from the renderer:** gives the renderer arbitrary file access.
- **Child-process IPC between main and service:** not available in `nuxt dev`,
  where the dev server, not the main process, runs the service.
