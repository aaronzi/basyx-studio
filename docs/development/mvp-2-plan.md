# MVP-2 plan: one edit on a live target and in a local AASX package

- Status: Planned
- Date: 2026-10-08
- Depends on: [MVP-1](mvp-1-plan.md) and its decision gate
- Scope decision gate: the target abstraction and the write path are proven for
  both data sources before features are ported

## Goal

Prove that one UI and one Studio API can edit AAS data regardless of where it
lives (DATA-003, DATA-016):

> choose target or open AASX file → browse → edit one property value → apply →
> see the new value after reload; a conflicting or forbidden write keeps the
> draft and explains why

Live targets go UI → `/api/studio/v1` → Studio BFF → `basyx-typescript-sdk` →
BaSyx. Desktop AASX workspaces go UI → `/api/studio/v1` → Studio BFF → local
Workspace Worker → package file. The routes, DTOs, revision tokens, and problem
types are the same; only the target capabilities differ.

MVP-1 hard-codes the only adapter: `kind` is `z.literal('live')` and
`openTarget` constructs `LiveAasTarget` directly. Building editing on that would
produce a live-only write path that must be redone for packages. That is why
MVP-2 adds both sources at once and keeps the edit itself small.

## Scope decisions

| Topic | MVP-2 decision |
| --- | --- |
| Edit operation | Set the value of a `Property` (and a `MultiLanguageProperty`) through the value-only representation. No structural edits (create, delete, move), no metadata edits. |
| Target contract | `AasTarget` interface in `server/lib/targets`, implemented by `LiveAasTarget` and `WorkspaceAasTarget`. A target router replaces the direct construction in `openTarget`. `kind` becomes `'live' \| 'workspace'`. |
| Capabilities | Each target reports `write`, `concurrency` (`strong` or `best_effort`) and `persistence` (`immediate` or `explicit_save`). The UI branches on capabilities, never on `kind`. |
| Revisions | The Studio API always uses `ETag` / `If-Match` with opaque Studio revision tokens. The adapter decides how strong the guarantee is (see [concurrency](#concurrency-on-live-targets)). |
| Drafts | Per target and element in Pinia (ADR 0006); never in the query cache. A failed apply keeps the draft. |
| Live targets | AAS and Submodel Repository only, as in MVP-1. |
| Upstream versions | `basyx-typescript-sdk` ≥ 2.3.0. The test environment moves from BaSyx Go 1.1.0 to the first release that contains conditional requests, pinned by version; a `SNAPSHOT` image pinned by digest bridges the gap until then. |
| Desktop workspace | Open an existing `.aasx`, edit, Save, Save As, close. No new packages, no attachments editing, no recovery snapshots. |
| Hosted web | No workspace targets. The workspace capability is absent in hosted mode. |
| Package engine | Chosen by a round-trip qualification in phase 0, run in a separate Electron `utilityProcess` (the Workspace Worker). |
| End-to-end tests | Playwright for the hosted build (PostgreSQL) and the packaged Electron app (PGlite), both against the test environment, in CI. |
| Component porting | Not in MVP-2. It starts after the app platform slice ([MVP-3](mvp-3-plan.md)) decides which BaSyx AAS Web UI plugins become core components and which become apps. |

### Concurrency on live targets

Upstream support landed on 2026-10-08:

- BaSyx Go ([basyx-go-components#742](https://github.com/eclipse-basyx/basyx-go-components/pull/742),
  closes [#737](https://github.com/eclipse-basyx/basyx-go-components/issues/737)):
  strong `ETag`s, `If-Match` / `If-None-Match`, `412`, and an optional `428`
  in all services. It is merged to `main` but not yet in a release (the latest
  release, 1.1.1, predates it); it needs database schema `v1.2.3`.
- `basyx-typescript-sdk` 2.3.0 ([basyx-typescript-sdk#547](https://github.com/eclipse-basyx/basyx-typescript-sdk/pull/547),
  closes [#546](https://github.com/eclipse-basyx/basyx-typescript-sdk/issues/546)):
  per-call `ifMatch` / `ifNoneMatch`, `etag` in every `ApiResult`, and
  `preconditionFailed` / `preconditionRequired` flags. Published to npm on
  2026-10-08; Studio's `minimumReleaseAge` allows installing it one day later.
- The AAS API specification does not define ETags yet
  ([aas-specs-api#691](https://github.com/admin-shell-io/aas-specs-api/issues/691)),
  so other servers and older BaSyx Go versions send none.

BaSyx Go semantics that shape the adapter:

- **One revision per top-level resource.** A submodel element shares the
  revision of its submodel. A tag read from an element works as `If-Match` for
  writes to that element, because writes compare only the revision part.
- **Coarse conflicts.** A change to *any* element of the submodel invalidates
  the tag, so two users editing different properties of one submodel conflict.
- **`412` carries no current tag.** The current state must be read again.
- **`PATCH` returns the new tag; `PUT` does not.** JSON representations above
  16 MiB are streamed without a tag.

The live adapter therefore has two modes, selected per read from whether the
downstream response carries an `ETag`:

- **`strong`:** the Studio revision token holds the downstream `ETag` and a
  hash of the element as read. Apply sends the tag through the SDK's `ifMatch`.
  On `preconditionFailed`, the BFF reads the element again: if its value still
  equals the hashed base, the conflict came from another element of the same
  submodel, and the BFF retries once with the new tag (still conditional, so a
  concurrent change is still detected). Otherwise it returns
  `revision_conflict` with the current value.
- **`best_effort`:** for targets without `ETag`. The token is only the element
  hash. On apply, the BFF reads the element again, compares the hash, and writes
  unconditionally if it matches. A write by someone else between that check and
  the write is not detected; the UI states this for these targets.

After a successful apply, the BFF reads the element again and returns the stored
(normalized) value with a fresh token. `preconditionRequired` (a target that
requires `If-Match`) maps to a typed problem; it cannot occur in `strong` mode.

### Workspace semantics

Applying an edit to a workspace target changes the Worker's in-memory model and
advances its revision; the package file changes only on Save. The UI shows the
unsaved state (UX-005) and asks before closing a window or workspace with
unsaved changes. Save writes a temporary file in the same directory and renames
it over the original.

## Studio API changes

| Method and path | Purpose |
| --- | --- |
| `GET /targets/{id}/submodels/{key}/elements/{elementKey}` | Now returns an `ETag` (Studio revision token). |
| `PUT /targets/{id}/submodels/{key}/elements/{elementKey}/value` | Set the value. Requires `If-Match`. Returns the new value and `ETag`, or `revision_conflict` (412) with the current value, or `target_forbidden`. |
| `GET /targets/{id}` | Adds `capabilities`. |
| `GET /workspaces` | Open workspaces of this desktop session. Desktop only. |
| `POST /workspaces` | Open a package from a file handle issued by the Electron main process; returns the target ID and import diagnostics. |
| `POST /workspaces/{id}/saves` | Save atomically to the opened file. |
| `POST /workspaces/{id}/exports` | Save As to a new file handle. |
| `DELETE /workspaces/{id}` | Close; refuses with `unsaved_changes` unless `force` is set. |

Native dialogs are an Electron IPC contract, not part of the HTTP API. MVP-2
adds the first preload script: two schema-validated calls, `chooseAasxFile` and
`chooseSaveLocation`, which return short-lived opaque handles. The renderer
never sees a native path.

## Definition of done

Run against the [test environment](../../test-setup/README.md):

1. **Shared contract.** Browsing pages, components, and query keys contain no
   `kind` checks. A live target and a workspace target are opened through the
   same routes and render the same tree.
2. **Live edit.** A user with write access (a new test user with only the
   `basyx-admin` BaSyx role, not `studio-admin`) changes a property on the open
   target and on the secured target. Both modes, delegated user and client
   credentials, work. After a reload the new value is shown.
3. **Forbidden write.** `alice` (`basyx-reader`) edits a property; apply returns
   `target_forbidden`, the draft remains, and reading still works.
4. **Conflict.** Two sessions edit the same property; the second apply gets
   `revision_conflict` with the current value and keeps its draft. Two sessions
   editing *different* properties of one submodel both succeed (retry after the
   submodel-level `412`). An integration test with the `ETag` header removed
   covers `best_effort` and documents its race window.
5. **Desktop package.** In the packaged app, open
   `IESEDriveMotorDM3000.aasx`, edit a property, Save, close, reopen: the value
   persists. Save As writes a second file and leaves the first unchanged.
   Closing with unsaved changes asks for confirmation.
6. **Package safety (DATA-006).** Fixture packages with path traversal, absolute
   paths, too many entries, an oversized or highly compressed entry, and invalid
   XML/JSON are rejected with a typed problem, and the Worker stays responsive.
7. **Round trip.** Each fixture in the golden set opens, saves without edits, and
   reopens with semantically equal content and byte-identical supplementary
   files.
8. **End-to-end in CI.** Playwright runs the browsing and edit flows for hosted
   (PostgreSQL) and packaged Electron on Linux (PGlite, under `xvfb`). The
   target-switch test from MVP-1 is included.
9. **MVP-1 gate closed.** The PGlite footprint is accepted by the maintainers,
   or the `embedded-postgres` fallback has been measured with the same schema.

## Phases

| Phase | Content | Exit |
| --- | --- | --- |
| 0. Decisions and harness | PGlite footprint decision; package-engine round-trip qualification; Playwright harness for both runtimes with the MVP-1 flows; upgrade to `basyx-typescript-sdk` 2.3.0 and a BaSyx Go image with conditional requests | Engine chosen; e2e green in CI; smoke test checks `ETag` and `412` |
| 1. Target contract | `AasTarget` interface, target router, capabilities in the contract, `kind` union; no behavior change | MVP-1 tests and e2e unchanged and green |
| 2. Live write | Revision tokens, value `PUT`, conflict and forbidden handling, draft store, edit UI for `Property` and `MultiLanguageProperty` | DoD 2–4 |
| 3. Workspace read | Preload and IPC handles, Workspace Worker process with supervision, open and browse a package, import limits | DoD 1, 6 |
| 4. Workspace write | Apply, Save, Save As, close guard, round-trip suite | DoD 5, 7 |
| 5. Wrap-up | Results section, ADR updates, `openapi.yaml` sync | DoD 8–9 documented |

## ADRs to write during MVP-2

- Revision tokens: `strong` and `best_effort` modes, and the retry after
  submodel-level conflicts.
- Desktop package engine and Workspace Worker process model.
- Electron preload and IPC contract (first IPC surface, SEC-009).

## Known risks

| Risk | Mitigation |
| --- | --- |
| BaSyx Go releases conditional requests later than MVP-2 needs them | `SNAPSHOT` image pinned by digest in the test environment; switch to the release when it appears |
| Submodel-level revisions cause conflicts between unrelated edits | Retry once when the element itself is unchanged; ask BaSyx Go for element-level revisions only if retries show up in practice |
| Targets without `ETag` (other servers, older BaSyx Go) | Explicit `best_effort` capability shown in the UI; the specification proposal aims to make ETags common |
| No TypeScript AASX library passes the round-trip qualification | Qualify early in phase 0; fall back to the aas-core JSON/XML de/serializers plus an OPC zip layer owned by the Worker |
| Electron e2e is flaky on CI (`xvfb`, startup time) | Start with Linux only; keep macOS packaged checks manual until stable |
| The first preload widens the renderer attack surface | Two calls, schema-validated in both directions, handles instead of paths, covered by security tests |

## Out of scope

Structural edits, concept descriptions, attachments, autosave and recovery
snapshots, new packages, registry and discovery, cross-target copy, porting BaSyx
AAS Web UI components, Windows and macOS e2e in CI.
