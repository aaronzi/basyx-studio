# 0014: Workspace Worker process and AASX package engine

- Status: Accepted
- Date: 2026-10-08
- Deciders: BaSyx Studio maintainers
- Refines: the Workspace Worker of [ADR 0003](0003-aas-targets-and-workspaces.md)
- Requirements: DEP-004, DATA-005, DATA-006, DATA-007

## Context

The desktop app opens user-chosen AASX packages, which are untrusted archives.
Parsing must not block or crash the local Studio Service, and malformed or
hostile packages must not exhaust memory or CPU (DATA-006).

## Decision

- The Workspace Worker is a separate Node process, forked and supervised by the
  local Studio Service (Electron's binary running as Node in the packaged app).
  It owns the opened packages and their models and serves one request at a
  time over IPC. It is bundled with esbuild next to the Nitro server.
- Every request has a time limit (open: 120 s, others: 30 s). Exceeding it kills
  the worker; the next request starts a fresh one, and open workspaces of the
  killed worker are gone.
- Packages are read and written with `aas-package3-typescript` and AAS Core 3.1
  (XML or JSON spec, as the package has it). Before the library decompresses,
  Studio checks the central directory: entry names, entry count, declared sizes
  and compression ratios. The decompressor writes at most an entry's declared
  size.
- Saving writes a temporary file in the target directory and renames it over
  the target.
- Supported for now: AAS 3.1 packages with one spec part.

## Consequences

- A hostile package can only cost one worker process, bounded in memory by the
  checked sizes and in time by the limit.
- Dev mode, tests and the packaged app run the same worker code.
- Saved packages are stored uncompressed, because the library writes ZIP level
  0; they can be larger than the original.
- AAS 3.0 packages and packages with several specs need follow-up work.

## Alternatives considered

- **Electron `utilityProcess`:** only available in the packaged app, not in
  `nuxt dev` or tests, and the Studio Service is not an Electron process.
- **Parsing in the Studio Service:** a large or hostile package would block or
  crash every request.
- **A custom OPC/ZIP layer:** more code to maintain than the aas-core-works
  package library, which passed the round-trip tests.
