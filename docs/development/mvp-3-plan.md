# MVP-3 plan: runtime-installable apps

- Status: Planned
- Date: 2026-10-08
- Depends on: [MVP-2](mvp-2-plan.md) phase 1 (target contract); the write
  capability needs MVP-2 phase 2. A read-only start can run in parallel with
  MVP-2.
- Scope decision gate: the extension model is proven before BaSyx AAS Web UI
  features are ported

## Goal

Prove [ADR 0004](../adr/0004-runtime-installable-apps.md) with the two
extension types the BaSyx AAS Web UI has today, plus one app with server-side
logic:

> an administrator installs an app package while Studio is running → users see
> it without a reload of the service → a submodel view appears for matching
> submodels, a module appears in the navigation → both read and write AAS data
> only through declared capabilities → uninstalling removes them

| BaSyx AAS Web UI | Studio app contribution |
| --- | --- |
| Submodel plugin (Vue component compiled in, selected by `semanticId`) | **Submodel view**: sandboxed UI entry offered for submodels whose semantic ID matches the manifest |
| Module (page compiled in, own route and menu entry) | **Module**: sandboxed UI entry with its own Studio route and navigation item |
| None | **Backend app**: app code in an isolated runtime that calls Studio capabilities with a scoped token |

In the BaSyx AAS Web UI both types are built into the bundle. In Studio they
are installed data, so the core UI only knows the contribution points, not the
apps.

The result also decides, for each BaSyx AAS Web UI plugin and module, whether
it becomes a core Studio component or an app. That list is the input for
porting.

## Scope decisions

| Topic | MVP-3 decision |
| --- | --- |
| Distribution | Install from a local `.zip` or directory (developer mode, APP-015). No marketplace, OCI registry, signing, or review. Installations are marked unsigned. |
| Integrity | Studio computes the SHA-256 digest at install, stores the files content-addressed, and verifies the digest when serving. This keeps ADR 0004's digest pinning without the marketplace. |
| Manifest | Versioned JSON Schema (draft 2020-12), validated with Ajv (ADR 0006). Contains ID, version, publisher, Studio API range, entry points, contributions, requested capabilities. |
| Contribution points | `submodelViews` (semantic IDs, title, entry) and `modules` (title, icon, route segment, entry, target-scoped or global). Graphical-builder widgets come later. |
| UI isolation | Sandboxed `iframe` without `allow-same-origin`, on a separate origin: a configured app host name in hosted mode, a `studio-app:` protocol registered on the renderer session in Electron. Strict CSP per app. |
| Bridge | `postMessage` over a `MessageChannel`, versioned protocol `studio-sdk/0`, every message validated with Zod on the host side. |
| Studio SDK | `@basyx/studio-sdk` as a pnpm workspace package in this repository: RPC client, types, and context helpers. Published to npm later. |
| Capabilities | `studio.ui.context` (target, shell, submodel, element, locale, theme tokens), `studio.ui.notify`, `studio.aas.getShell`, `studio.aas.getSubmodel`, `studio.aas.getElement`, `studio.aas.setElementValue` (MVP-2 write path: apps pass the revision token from `getElement` and get the same `strong` or `best_effort` semantics as the core UI). |
| Authorization | Every call is checked against the installed manifest *and* the signed-in user's target access, then audited with the app identity. An app never gains rights the user lacks. |
| Installation scope | Hosted: deployment-wide, by `studio-admin`. Desktop: current OS user. Per-user or per-group visibility (SEC-006) is out of scope. |
| Runtime install | Install, update and uninstall change only database rows and app files. The Studio Service and the renderer bundle are not rebuilt or restarted. Open sessions pick up changes through query invalidation. |
| Backend apps | Phase B. Deno with deny-by-default permissions, one process per app version, started and supervised by the Studio Service; network access only to the Studio capability endpoint. Container isolation for hosted production is out of scope. |

## Studio API changes

| Method and path | Purpose |
| --- | --- |
| `GET/POST /app-installations` | List installations; install from an uploaded package (admin, async, returns validation findings). |
| `GET/DELETE /app-installations/{id}` | Details and requested capabilities; uninstall. |
| `GET /app-contributions?targetId&submodelKey` | Submodel views and modules applicable in this context, with the reason for each match. |
| `POST /app-calls` | Capability call from the host bridge on behalf of an installation, or from a backend app with its capability token. |

`/apps/catalog`, updates, rollbacks, visibility, and activations from the
[endpoint overview](../api/endpoints.md) stay for the marketplace work.

## Definition of done

Run in hosted web and packaged Electron against the test environment:

1. **Install at runtime.** `studio-admin` installs the demo apps while `alice`
   has Studio open. Within one refresh of the contribution list, without a
   service restart, `alice` sees them. Uninstalling removes them in the same
   way.
2. **Submodel view.** A *Digital Nameplate* app (IDTA 02006) is offered as a tab
   next to the generic tree for the nameplate submodels in the test environment
   and in `IESEDriveMotorDM3000.aasx`, and is not offered for other submodels.
   The UI explains why it matches.
3. **Module.** A demo module adds a navigation entry and a route and lists data
   of the active target through capabilities. Switching targets updates it
   without showing data from the previous target.
4. **Write through an app.** The nameplate view edits one value through
   `studio.aas.setElementValue`; conflicts and forbidden writes return the
   same typed problems as the core UI. `alice` (read-only) gets
   `target_forbidden`.
5. **Undeclared capabilities are refused.** A test app calling a capability it
   did not declare gets a typed refusal, and the call is audited.
6. **Isolation holds.** Security tests prove that an app cannot read Studio
   cookies or storage, cannot call `/api/studio/v1` directly, cannot navigate
   the top window, cannot open the bridge of another app, and cannot load code
   outside its own package.
7. **Invalid packages are rejected.** Schema violations, incompatible Studio API
   ranges, path traversal in the archive, and oversized packages fail with
   findings and leave nothing installed.
8. **Backend app (phase B).** A backend app runs in its own Deno process with
   only the capability endpoint allowed, reads AAS data with a short-lived
   capability token, and is stopped on uninstall. Killing its process does not
   affect the Studio Service.
9. **Classification.** Every plugin and module of the BaSyx AAS Web UI is
   listed as core component, app, or dropped, with a reason.

## Phases

| Phase | Content | Exit |
| --- | --- | --- |
| 0. Contracts | Manifest JSON Schema, `studio-sdk/0` message protocol, capability list, app origin design per runtime | Reviewed schema and ADR draft |
| A1. Install and serve | Package validation, digest storage, install/uninstall API and admin UI, app origin in hosted and Electron | DoD 7 |
| A2. Bridge and read capabilities | Host bridge, `@basyx/studio-sdk`, context and read capabilities, authorization and audit | DoD 5–6 |
| A3. Contribution points | Submodel view tab and module route; Nameplate and demo module apps | DoD 1–3 |
| A4. Write capability | `setElementValue` on the MVP-2 write path | DoD 4 |
| B. Backend app | Deno runner, supervision, capability tokens, demo backend app | DoD 8 |
| C. Wrap-up | Classification list, results section, ADR updates | DoD 9 |

Phases A1–A3 need only the MVP-2 target contract, so they can start while
MVP-2 builds the write path.

## ADRs to write during MVP-3

- App manifest schema and versioning.
- App origin per runtime (hosted host name, Electron protocol) and CSP.
- Capability RPC protocol and authorization model.
- Backend app runner: Deno qualification on all desktop platforms and in
  containers.

## Known risks

| Risk | Mitigation |
| --- | --- |
| A separate app origin complicates hosted deployment (DNS, TLS, cookies) | One extra host name served by the same Nitro process; documented in the deployment guide; dev uses `*.localhost` |
| Sandboxed iframes limit what apps can do (downloads, popups, clipboard) | Add host-mediated capabilities when a demo app needs them, never by relaxing the sandbox |
| Apps look foreign inside Studio | Pass Vuetify theme tokens and locale in `studio.ui.context`; offer a small style kit in `@basyx/studio-sdk` |
| Bundling Deno with Electron adds size and platform work | Phase B is separate and may ship desktop-only first; measure size and startup |
| The developer-mode install path becomes the de facto distribution | Unsigned installations are labelled and can be disabled by deployment policy; the marketplace replaces them |

## Out of scope

Marketplace, signing, OCI artifacts, publisher review, per-user or per-group
visibility, app updates and rollback, graphical-builder widgets, file and HTTP
egress capabilities, privileged or native apps, container isolation for hosted
backend apps.

## After MVP-3

- Port BaSyx AAS Web UI components and modules according to the classification.
- Registry and discovery resolution.
- Cross-target AAS copy. With BaSyx Go conditional requests, the default
  `fail_without_changes` policy can write with `If-None-Match: *` (create-only
  `PUT`), so a resource created concurrently in the destination is never
  overwritten.
- Marketplace: catalogue, signed OCI artifacts, updates, rollback, visibility.
