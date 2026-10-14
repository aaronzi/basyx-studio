# Plan: port the AAS viewer prototype into Studio

- Status: Draft. Scope decisions were made on 2026-10-14 (see [Decisions](#decisions)). The [remaining questions](#remaining-questions) are still open.
- Date: 2026-10-14
- Source: `../aas-viewer-prototype` (Vue 3 + Vite + Vuetify 4, mock data only)
- Depends on: [MVP-1](mvp-1-plan.md), [MVP-2](mvp-2-plan.md), [MVP-3](mvp-3-plan.md)

## Goal

Bring the prototype's interaction design (shell list, shell header, submodel
tree with details, overview cards, ⌘K search, dashboard, concept
descriptions) into Studio. It must follow Studio's architecture, contracts and
UI rules. The goal is the UX, not the prototype's code or its data layer.

## What gets ported and what is replaced

The prototype's own `IMPLEMENTATION_PLAN.md` assumes a **browser-only client**:
`fetch` to BaSyx from `src/api/`, OIDC PKCE in the browser (`oidc-client-ts`),
and infrastructures in `localStorage`. Studio does not allow this:

| Prototype assumption | Studio rule | Consequence |
| --- | --- | --- |
| Browser calls BaSyx directly | DATA-016, ADR 0002: the UI talks only to `/api/studio/v1` | Phases 2–3 of the prototype plan are dropped. New BFF routes are added instead. |
| Browser holds OIDC tokens | SEC-001 | Use the existing `TargetAuthorization` flow |
| Users add infrastructures (Connect dialog, `localStorage`) | Admin-managed infrastructures in the DB (`/admin/infrastructures`) | The prototype's `InfrastructureDialog` and Settings list are not ported. Only the UI ideas (test connection, capability chips) are merged into the admin page. |
| Raw HTTP to BaSyx | DATA-001: use `basyx-typescript-sdk` | Every new downstream call needs SDK support or an upstream SDK change (see Q8) |
| Features gated on BaSyx Go `features` | ADR 0003: UI branches on **target capabilities**, never on kind | Extend `targetCapabilitiesSchema`. Workspace (AASX) targets must answer every capability. |
| Global View/Edit toggle, `PATCH $value` without a precondition | ADR 0013: revisions, `If-Match`, drafts in Pinia | Editing reuses `ElementValueEditor` and the drafts store |
| `/viewer/:aasId`, global "All infrastructures" filter | UX-001: choose a target first. The design guidelines forbid showing one target's cached data in another context. | Routes stay `/targets/[targetId]/shells/[shellKey]`. "All infrastructures" is dropped, or becomes a separate feature (Q3). |
| md3 blueprint, own palette, `rounded="xl"`, `solo-filled` fields | `vuetify.config.ts` is the only theme source, with BaSyx brand colours | Prototype templates are rewritten to Studio defaults and aliases. New defaults or aliases are added where a role repeats (Q2). |
| Hard-coded English, API paths in subtitles (`GET /lookup/shells`) | Vue I18n. Design guidelines ask for plain AAS language. | All strings go to `i18n/locales/en.json`. API paths are removed from the UI (Q10). |
| JS, no semicolons | TypeScript, ESLint config of the repo | Rewrite, not copy |

## Feature inventory and proposed handling

| Prototype feature | Exists in Studio today | Needs | Proposed phase |
| --- | --- | --- | --- |
| Shell list drawer (filter, kind chips, favorites, sort) | Plain list on target page | UI. Thumbnails need a BFF route. Favorites need storage (Q6). | A |
| Shell header (identifiers, copy, asset kind/type chips) | Breadcrumb only | UI. `ShellSummary` already has the fields. | A |
| Submodel tree (`v-treeview`, filter, expand/collapse all, values inline) | `ElementTree` (lazy, per submodel) | Decide lazy vs. full load (Q5) | A |
| Element details drawer (breadcrumbs, metadata, description, qualifiers, raw JSON) | `JsonPanel` + editor pane | UI over `ElementDetail` | A |
| Typed value views (Property, MLP, Range, File, collection) | `ElementValueEditor` (Property, MLP) | UI. Range/File editing needs new write paths. | A (view) / C (edit) |
| Auto-refresh + sparkline | none | BFF `$value` read, bounded polling (ADR 0007) | B |
| Overview tab (Nameplate, PCF, Documents, Technical Data, live KPIs) | App submodel views (MVP-3) | Core or apps? (Q4) | B |
| JSON tab | `JsonPanel` | Reuse | A |
| ⌘K command palette (actions, shells, elements, asset-ID lookup) | none | Actions + loaded shells: UI only. Server search needs `/query` and Discovery (Q8, Q9). | A (local) / C (server) |
| Dashboard (recent changes, discovery, recently opened, infra health) | Home = target picker | Event Feed, Discovery, health per target (Q3) | C |
| Concept descriptions page | Endpoint type exists, no route | BFF list route + page | B |
| Operations invoke (sync/async) | none | BFF routes, permissions, workspace behaviour (Q8) | C |
| File download / replace, thumbnail | none | BFF attachment routes, size limits | B / C |
| Export (AASX/JSON/XML), Upload | Workspace export exists | Live `/serialization`, `/upload` via BFF with DATA-006 checks | C |
| Delete shell | none | BFF route, confirmation (UX-003) | C |
| History ("Now ▾") | none | BaSyx Go `$history`. Experimental (Q7). | D |
| Changes tab / Event Feed | none | BaSyx Go `/events`. Experimental (Q7). | D |
| Share (ReBAC) | none | `$access` routes. Experimental (Q7). | D |
| Settings (theme, MLP language, poll interval) | Theme cycle in app bar | Where do user preferences live (Q6) | B |
| Mobile bottom navigation, rail | none | Q11 | A |

## Proposed phases

Every phase ends with lint, typecheck, unit tests and the web and desktop
Playwright suites passing. It must work against `test-setup` for a live
target and for an AASX workspace.

**Phase A: shell browser UX (UI only, existing API)**
1. Add the layout shell: nav rail and drawers to `layouts/default.vue`, or a
   nested layout for target pages. Add aliases and defaults to `vuetify.config.ts`.
2. Target page: shell list drawer with client-side filter/sort and infinite scroll.
3. Shell page: header, tabs (Submodels, JSON), tree with inline values, and a details drawer that replaces the 3-pane layout (Q1).
4. Typed read-only value views. Editing stays on `ElementValueEditor`.
5. ⌘K palette with actions and the loaded shells and elements.
6. i18n keys, e2e coverage for list → open → select → edit.

**Phase B: read extensions in the BFF**
1. Element value polling route (`…/elements/{key}/value` GET or the submodel `$value`) and auto-refresh with sparkline.
2. Concept descriptions route and page.
3. Thumbnail and attachment download routes (streamed, size-limited).
4. Overview: either core cards or a port to MVP-3 submodel-view apps (Q4).
5. User preferences (Q6).

**Phase C: write and operate**
Capability extensions (`delete`, `invoke`, `attachments`, `serialization`,
`upload`, `search`, `discovery`), each with a live and a workspace answer.
Then delete shell, file replace, operations, export/upload, server search and
Discovery, and the dashboard.

**Phase D: BaSyx Go experimental features**
History, Event Feed and ReBAC sharing. Do these only after Q7. They probably need
an ADR, because they bind Studio to BaSyx Go-specific APIs that are not in the
AAS specification.

## Decisions

| # | Topic | Decision | Consequence |
| --- | --- | --- | --- |
| D1 | Visual design | Port the prototype's look 1:1 (md3 blueprint, rounding, `solo-filled` fields, nav rail, list drawer, header card, tabs, details drawer), but **keep the BaSyx brand colours**. | `vuetify.config.ts` gets the md3 blueprint and the prototype defaults. Primary and secondary stay BaSyx cyan and orange (contrast-checked). The other prototype tokens (`surface-light`, `surface-variant`, `tertiary`, background) are adapted to BaSyx. The admin and apps pages change their look and need a visual check. |
| D2 | Multi-target | Per target only. No aggregated shell list. | The home page stays a target picker. The dashboard cards (recent changes, discovery, health) go to the target landing page `/targets/[targetId]`. |
| D3 | Overview | The cards become **MVP-3 submodel-view apps** (Nameplate, Carbon Footprint, Handover Documentation, Technical Data), matched by semantic ID. | The Overview tab is a host that shows the matching views of all of the shell's submodels. It needs a contribution query per shell, not per submodel. |
| D4 | Scope | Everything: ops and files, export/upload, search and discovery, history/events/ReBAC. | Phases A–D are all in scope. |
| D5 | Tree | Load a full submodel tree per submodel (size-capped) in one BFF call. Lazy loading is the fallback above the cap. | New BFF route that returns the submodel tree with values. The cap is configurable. |
| D6 | Preferences | Studio DB per user (PostgreSQL/PGlite), behind a `/me/preferences` route. Favorites and recent shells are per target. | Drizzle migration + upgrade test (DEP-007) |
| D7 | SDK gaps | Add a thin Studio-side client in `server/lib` for endpoints the SDK lacks, documented in an ADR, and replace it when the SDK catches up. | New ADR "BaSyx Go-specific endpoints outside basyx-typescript-sdk". It also covers that history, events and ReBAC bind Studio to BaSyx Go. |
| D8 | Edit mode | Keep the global View/Edit toggle (⌘E). Edit controls also need the capability, a revision and (with ReBAC) the effective right. | The toggle state lives in Pinia. Drafts and `If-Match` stay as in MVP-2. |
| D9 | API hints | Remove the API paths from the UI and use plain AAS language. | |
| D10 | Responsive | Port the breakpoint behaviour as it is (bottom navigation, fullscreen palette, temporary drawers). | Add a mobile-viewport Playwright project for the web build |
| D11 | BaSyx version | SNAPSHOT, as in `test-setup`. | Re-check every endpoint fact from the prototype plan §0 against SNAPSHOT before building it. Enable the event feed and history in the test-setup compose file. |

| D12 | Infrastructure model | Extend it. New endpoint types `aasEnvironment` (one base URL that serves every AAS service, and enables export, upload and element search) and `discovery`. An infrastructure needs either an `aasEnvironment` endpoint or both repositories. | The endpoints live in a JSON column, so no table change is needed. The admin form gets an *AAS Environment / Separate services* choice. |
| D13 | Workspaces | Live-only features (history, change feed, sharing, discovery, operations, upload) are not offered for AASX workspaces. Delete shell, file download/replace and search work locally. | The capabilities are answered per target, and the UI never branches on `kind`. |
| D14 | Overview apps | The four Overview apps ship out of the box as **bundled first-party apps**. They are installed at startup from the Studio build, need no developer mode, and are marked as bundled instead of unsigned. | New ADR. The build packages `apps/bundled/*`. |
| D15 | Sharing (ReBAC) | *Share* appears only when the target has ReBAC **and** uses `delegated_user`. With `unsecured` or `deployment_client_credentials`, BaSyx sees no person or only Studio's service account, so grants would not mean what the dialog suggests. The same rule applies to effective rights: they gate edit, delete, invoke and share only for `delegated_user`. | It follows the principle "show what the user can actually do". The admin page explains why sharing is unavailable. |
| D16 | Upload | Initial limit: 100 MiB (`STUDIO_UPLOAD_MAX_BYTES`). AASX uploads pass the same archive checks as workspace packages (DATA-006) and the AAS Core validation before Studio forwards them. JSON/XML uploads are validated with AAS Core. | Upload is refused with `package_rejected` and the findings |
| D17 | Delivery | One branch, `feature/aas-viewer-port`, with all phases. `requirements.md` and `design-guidelines.md` are updated in the branch. | |

## Remaining questions

None. New questions that come up during the implementation are recorded here.

## Unverified facts

- `node_modules` is not installed in the checkout, so I could not check which
  of the needed BaSyx APIs `basyx-typescript-sdk` 2.3.x covers (query,
  discovery lookup, serialization, upload, invoke, attachments, thumbnail,
  `$history`, events, `$access`).
- The prototype targets BaSyx Go **v1.1.1**. Studio's test environment runs
  the **SNAPSHOT** images. I have not checked whether the endpoint facts in the
  prototype plan (§0) still hold on SNAPSHOT.
