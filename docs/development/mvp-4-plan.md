# MVP-4 plan: the BaSyx AAS Web UI viewer, registries, discovery and query search

- Status: Planned
- Date: 2026-10-13
- Depends on: [MVP-3](mvp-3-plan.md) (implemented: submodel views and
  modules as apps, classification of the BaSyx AAS Web UI's plugins and
  modules), and `basyx-typescript-sdk` 2.4.0 (released 2026-10-14, in use)
  with
  [eclipse-basyx/basyx-typescript-sdk#549](https://github.com/eclipse-basyx/basyx-typescript-sdk/issues/549)
  (query clients) and
  [eclipse-basyx/basyx-typescript-sdk#550](https://github.com/eclipse-basyx/basyx-typescript-sdk/issues/550)
  (descriptor endpoint resolution)
- Scope decision gate: Studio's core browsing matches the BaSyx AAS Web UI's
  viewer on a large environment and on registry-based infrastructures, so that
  ports of submodel apps, previews and editors can build on it

## Goal

Rebuild the viewer of the BaSyx AAS Web UI (`/aasviewer`) from Studio's own
components, with the same layout and the same ways to find a shell: through
an AAS registry or repository, by asset ID through discovery, and by server-side
search with the AAS Query Language (PROD-001):

> an administrator configures an infrastructure with registries and discovery →
> a user opens it, finds a shell in the AAS list by scrolling, by query search,
> or by asset ID → expands its submodels and elements in one tree → sees the
> selected element's details, its JSON, and matching submodel apps → resizes
> or collapses the panes → follows a deep link to the same element

| BaSyx AAS Web UI | Studio after MVP-4 |
| --- | --- |
| Infrastructure with AAS/submodel registry, discovery, AAS/submodel/CD repository; templates such as `full` and `mono-all` | Infrastructure with the same endpoint types; a single-URL shortcut in the admin form for an AAS environment |
| Navigation drawer (336 px): AAS list from registry or repository with reload, search and menu; virtual-scrolled rows with idShort, ID and an offline marker; AAS details at the bottom | Navigation drawer with the shell list and shell details, from the registry or repository through the BFF |
| Quick search and filter chips, advanced query dialog (raw JSON), via `/query/shells` or `/query/shell-descriptors` | The same search syntax and dialog; the BFF validates the query and calls the target |
| `?globalAssetId=` links and QR codes resolved through discovery | `?globalAssetId=` links and an asset-ID lookup resolved through discovery (QR scanning later) |
| `SubmodelTree` (35 %): submodels as top-level folders, resolved through the submodel registry | `SubmodelTree` on `v-treeview`: submodel refs as roots, resolved the same way, element levels loaded on demand |
| Resizable divider between tree and view | `Splitter` from `@vuetify/v0`, sizes remembered |
| Right pane (65 %): *Element Details*, *Visualization*, *JSON*, *UML* | *Details*, *Visualization* (app submodel views), *JSON* |
| On mobile: separate `AASList`, `SubmodelList` and `Visualization` routes | Temporary drawer and one pane at a time |

The UI is a rewrite, not a code port. The Web UI's `AASList.vue` (1,362 lines),
`SubmodelTree.vue` (2,072) and `Treeview.vue` (826) call BaSyx services from
the browser, depend on its infrastructure store, and use inline styles and DOM
manipulation that Studio does not allow. In Studio, registry resolution, query
validation and discovery run in the BFF, behind the target contract
(DATA-003, DATA-016), with `basyx-typescript-sdk` as the client (DATA-001).

## Scope decisions

### Infrastructures

| Topic | MVP-4 decision |
| --- | --- |
| Endpoint types | `aasRegistry`, `submodelRegistry` and `aasDiscovery` join `aasRepository`, `submodelRepository` and `conceptDescriptionRepository`. Each type at most once. |
| Valid combinations | At least one of `aasRepository` and `aasRegistry`, and at least one of `submodelRepository` and `submodelRegistry`. Registry-only infrastructures are allowed (the Web UI's registry-based templates). |
| Single-URL shortcut | The admin form can fill all six endpoint types from one AAS environment base URL (the Web UI's `mono-all`), and the admin removes the ones the server does not offer. Stored as individual endpoints; there are no templates in the data model. |
| List source | With both an AAS registry and an AAS repository, the administrator chooses the list source (`registry` default, or `repository`). No automatic fallback when the registry is empty, as the Web UI does: an empty registry is shown as empty, so a missing registry integration is visible. |
| Descriptor endpoints | Used as in the BaSyx AAS Web UI, as long as they point into a component of the infrastructure: a descriptor's `href` is followed only if it lies under the base URL of one of the infrastructure's configured endpoints (same scheme, host and port, and the base path as a prefix at a segment boundary). Anything else is `blocked`, shown on the row, and never contacted, so the target token never leaves the configured services. The outbound policy for targets checks these base URLs instead of only their origins. No URL rewriting of internal host names: the registry must publish the URLs Studio is configured with (BaSyx Go: `GENERAL_EXTERNALURL`). |
| Service profiles | The probe reads `/description` of every endpoint and stores the profiles with the infrastructure, at create, update and every probe. Query support is derived from them (below). |
| Security | One security mode per infrastructure, as today: the same token is sent to all its endpoints. Different credentials per endpoint are out of scope. |

### Resolution

| Topic | MVP-4 decision |
| --- | --- |
| Where data comes from | For single resources, the SDK's `AasService` and `SubmodelService` decide where to read from, so Studio does not keep its own registry-then-repository logic. Per request, Studio configures them with the infrastructure's endpoints, the guarded fetch and the target token, and with the endpoint hook from #550 that applies the base-URL rule above before a descriptor endpoint is contacted. |
| Shell list | From the list source through the SDK clients directly: `AasRegistryClient.getAllAssetAdministrationShellDescriptors` or `AasRepositoryClient.getAllAssetAdministrationShells`, cursor-paged. Rows from descriptors carry idShort, ID, display name, asset kind and global asset ID, so the list needs no request per row. Not `AasService.getAasList`: it fetches every shell behind a page of descriptors (one request per row) and falls back to the repository when no descriptor resolves, which would hide an empty or broken registry. |
| Opening a shell | With a registry: descriptor by ID → AAS endpoint (interface `AAS-3.x`, then `AAS-REPOSITORY-3.x`, the Web UI's order, #550) → GET. Without one, or if the descriptor has no usable endpoint: the configured AAS repository. |
| Submodels | Per submodel reference: with a submodel registry, descriptor → `SUBMODEL-3.x` endpoint; otherwise the configured submodel repository. Writes go to the resolved endpoint with the MVP-2 revision rules. Submodel refs gain the status `blocked` next to `forbidden`, `not_found` and `error`. |
| Row availability | The Web UI's online/offline marker. The UI asks for the rows in view (± a few), at most 50 keys per request; the BFF resolves them with at most 4 concurrent requests per target and answers `available`, `forbidden`, `not_found`, `blocked` or `unreachable`. No timer: checks run when rows come into view and on reload. |
| Discovery | Asset ID → AAS IDs through `/lookup/shells` (global asset ID, and specific asset IDs as `name=value`). Used by `/targets/{targetId}?globalAssetId=…` deep links and by the asset ID search (below); one result opens the shell, several show a picker. Discovery writes (asset links on create and delete) come with editing. |
| SDK | All registry, discovery, repository and query calls go through `basyx-typescript-sdk` (DATA-001). Two upstream changes come first: query clients for `/query/shells`, `/query/shell-descriptors`, `/query/submodels`, `/query/submodel-descriptors` and `/query/concept-descriptions` (#549); and descriptor endpoint resolution that accepts `AAS-3.x`/`SUBMODEL-3.x` (the SDK matches `AAS-3.0` exactly, while BaSyx Go's registry sync writes `AAS-3.2`), selects submodel endpoints by interface, and lets the caller control the configuration of every descriptor endpoint request (#550). Both are in 2.4.0, which Studio uses since 2026-10-14 under an exact-version release-age exception ([ADR 0012](../adr/0012-release-age-exceptions-for-basyx-packages.md)). |

### Search

| Topic | MVP-4 decision |
| --- | --- |
| Search syntax | The Web UI's: free text plus `field:value` (contains), `field=value` (equals), `field!=value` and `-field:value` (not), quoted values; fields `id`, `idShort`, `assetKind`, `assetType`, `globalAssetId`, `specificAssetId`. Free text matches ID, idShort, global asset ID and specific asset ID values case-insensitively, as in the Web UI (not the display name). The parser is shared code, so the field shows chips and suggestions with the same rules the server applies. |
| Server-side search | The BFF turns a search expression into an AAS Query Language query, built with the SDK's `Query` model (`$condition` with `$or`/`$and`, `$regex`, `$contains`, `$eq`, `$not`, roots `$aas` or `$aasdesc`), and sends it through `queryAssetAdministrationShellDescriptors` or `queryAssetAdministrationShells` of the list source, cursor-paged like the list. |
| Advanced query | A dialog for raw query JSON, as in the Web UI (which has no builder). The BFF validates it with Ajv against the IDTA-01002-3 query JSON Schema, limits it to 64 KiB, allows only the roots of the queried endpoint, and rejects `$select` (Studio needs full objects for its rows). Findings are shown in the dialog. A valid query is converted with the SDK's `queryFromJsonable` and sent like an expression query; the Ajv check stays in front of it because it gives readable findings per path. Editing uses a monospace `v-textarea`; a code editor is not added for this. |
| Query support | Derived from the stored profiles (the BaSyx query profiles the Web UI checks, version ≥ 3.2, and the IDTA query profiles), because BaSyx Go does not label them consistently. If the list source cannot query but the other AAS endpoint can, that one is used and the UI names it. If neither can, the search falls back to the client filter of loaded rows with a hint, as the Web UI does. A `404`, `405` or `501` from a query endpoint marks it unsupported until the next probe. |
| Shareable searches | `?search=` (expression) and `?query=` (base64url JSON) on the target route, like the Web UI's `aasSearch`/`aasQuery`. |
| Workspace targets | AASX packages have no query endpoint. The workspace worker evaluates the quick search expression over the package's shells (same fields and operators); the advanced dialog is not offered. |
| Authorization and audit | Queries run with the user's token, so the target's access rules apply to results. Search requests follow the existing `target.read` audit rule; the query text is not logged. |

### Viewer

| Topic | MVP-4 decision |
| --- | --- |
| Layout source | The Web UI viewer on `main` of 2026-10-09: drawer 336 px, tree 35 %, view 65 %, the right pane's mode toggle above the content. Matching data, layout and behaviour count; pixel identity does not. Studio's theme, typography and icons stay. |
| Pane resizing | `Splitter.Root`, `Splitter.Panel` and `Splitter.Handle` from `@vuetify/v0`. Vuetify 4.2.4 has no splitter in core or labs; `@vuetify/v0` is Vuetify's headless layer and is already in the lockfile as a dependency of `vuetify@4.2.4`, so it becomes a direct dependency at the same version (`1.2.3`) without a new package. The panels set their own `flex-basis`; Studio templates style the handle with Vuetify utility classes and `v-divider` only, so the no-custom-CSS rule holds. |
| Drawer | `v-navigation-drawer` with the Web UI's width (336), toggled from the app bar; `temporary` below `md`. Not resizable, as in the Web UI. |
| Remembered layout | Pane sizes, the collapsed tree, the drawer state and the right pane's mode are per browser in `localStorage`, read only on the client. |
| Routes | Unchanged: `/targets/{targetId}` (list, no shell open) and `/targets/{targetId}/shells/{shellKey}?submodel=&element=&mode=`. MVP-1 to MVP-3 deep links keep working; MVP-3's `?view=` maps to `?mode=visualization&view=`. A `viewer` layout holds the drawer, so the list keeps its pages and scroll position while shells change. |
| Row actions | Copy shell ID, copy global asset ID, copy Studio link. Download, edit, delete, create and create instance need API surface Studio does not have yet. Studio does not hand out service endpoints. |
| Shell details | Collapsible section at the bottom of the drawer, as in the Web UI: asset kind, global asset ID, specific asset IDs, asset type, display name, description, administration, and the source (registry or repository) and resolved endpoint origin. No thumbnail (needs file streaming). |
| Tree | One `v-treeview`: submodel refs as roots with their status, elements loaded per level. Icons follow the Web UI. The tree header has reload and collapse all, and filters loaded nodes through the `search` prop. |
| Deep links into the tree | `ElementDetail` gains `ancestors` (key, label and model type per level), so the tree can open the path to a linked element; the details header shows them as a breadcrumb. |
| Right pane | *Details*: a typed, read-only view per element type (Submodel, SubmodelElementCollection, SubmodelElementList, Property, MultiLanguageProperty, Range, File, Blob, ReferenceElement, RelationshipElement, AnnotatedRelationshipElement, Entity, Operation, Capability, BasicEventElement) with the Web UI's common header (idShort, displayName, description, semantic ID, supplemental semantic IDs, qualifiers, kind, administration). The MVP-2 value editor stays on Property and MultiLanguageProperty. *Visualization*: the MVP-3 submodel view apps, moved out of the tree pane's tabs. *JSON*: the existing `JsonPanel`. *UML* is out of scope. |
| Small screens | Below `md`: temporary drawer; the tree fills the page; selecting an element shows its details with a back button. |

### Test environment

| Topic | MVP-4 decision |
| --- | --- |
| Registry-based target | `basyx-open` enables BaSyx Go's registry integration (`GENERAL_AASREGISTRYINTEGRATION`, `GENERAL_SUBMODELREGISTRYINTEGRATION`, `GENERAL_EXTERNALURL`), so its registries are filled from the fixtures, and its Studio infrastructure is configured with all six endpoint types. Its registry, discovery and query endpoints are already served by `aasenvironment-go`. |
| Repository-based target | `basyx-secured` stays repository-only, so both resolution paths are tested, and the secured target keeps its current ABAC rules. |
| Foreign descriptors | A fixture descriptor in `basyx-open` points outside the configured base URLs, to test `blocked`. |
| Large profile | A `large` Compose profile adds a third `aasenvironment-go` with registry integration, 2,000 shells, a submodel with 5,000 elements across levels, and a SubmodelElementList with 1,000 entries. The default environment and its tests stay unchanged. |

## Design

### Layout

```text
┌ app bar: logo · Browse · Admin · Modules ·········· target chip · save · theme · user ┐
├──────────────┬───────────────────────────────┬────────────────────────────────────────┤
│ drawer 336px │ Splitter.Panel 35 %           │ Splitter.Panel 65 %                    │
│ ┌──────────┐ │ ┌ Submodels ─── ⟳  ⊟ ┐        │ ┌ [Details|Visualization|JSON] ────┐   │
│ │⟳ search ⋮│ │ │ ▸ 📁 Nameplate      │        │ │ breadcrumb                       │   │
│ │ chips    │ │ │ ▾ 📂 TechnicalData  │        ‖ │ header (idShort, semanticId, …)  │   │
│ ├──────────┤ │ │    ▸ ▤ General…     │        ‖ │ typed element view / editor      │   │
│ │ shell    │ │ │      ⓟ MaxTorque 40 │        │ │                                  │   │
│ │ shell  ⚠ │ │ │ 🔒 Secured          │        │ │                                  │   │
│ │ …virtual │ │ └─────────────────────┘        │ └──────────────────────────────────┘   │
│ ├──────────┤ │                               │                                        │
│ │ details ▾│ │                               │                                        │
└──────────────┴───────────────────────────────┴────────────────────────────────────────┘
```

- `app/layouts/viewer.vue` holds the drawer and the `<slot />`; the app bar
  moves from `default.vue` into `AppBar.vue`, which both layouts use. The
  target chip and the workspace actions move from `TargetHeader` into the app
  bar while a target is open, so the active target and unsaved state stay
  visible (design guidelines).
- `app/components/viewer/ViewerSplit.vue` wraps the splitter: two panels with
  minimum sizes, a collapsible tree panel, and a handle rendered as a
  `v-divider` with a grip icon, `aria-label`, and keyboard resizing from
  `@vuetify/v0`. Sizes are saved from the `layout` event.
- `app/stores/viewer.ts` keeps the remembered layout and reads `localStorage`
  only on the client, so server rendering uses the defaults.

### Shell list and search

- `ShellList.vue`: `useInfiniteQuery` on the list or on the search, rendered
  in `v-virtual-scroll`; the next page loads near the end. Rows show
  displayName or idShort, the ID, and the availability marker.
- `ShellSearchField.vue`: text field with field suggestions and chips, built
  on the shared parser; *Advanced* opens `ShellQueryDialog.vue`.
- The open shell is highlighted and scrolled into view; if it is not on a
  loaded page (deep link), it is pinned above the list until it appears.
- Switching targets discards the list, the search and the selection
  (DATA-011).
- `ShellDetails.vue` reads the shell the page already loads (shared query).

### Server

- `server/lib/aas/services.ts`: builds `AasService`, `SubmodelService` and the
  discovery client for one request (endpoint configurations with the guarded
  fetch and token, list source, the base-URL check as endpoint hook).
- `server/lib/aas/query.ts`: expression to an SDK `Query`, Ajv validation of
  raw queries (schema vendored from IDTA-01002-3 into `shared/aas/`), root
  check, then `queryFromJsonable`.
- `LiveAasTarget` reads through the services and gains `searchShells`,
  `shellAvailability` and `shellsByAssetId`; the workspace target implements
  `searchShells` for expressions.
- `server/lib/infrastructures.ts`: endpoint types and combinations, base URLs
  in the outbound policy, profiles stored at probe.

### Tree and right pane

- `SubmodelTree.vue` replaces `ElementTree.vue`. Roots come from
  `submodel-refs`; children use the elements endpoint with `parentElementKey`.
  Loaded levels stay in a map per parent key. `v-model:activated` is bound to
  `?submodel=` and `?element=`; `v-model:opened` is restored from `ancestors`.
- `ElementPane.vue`: `v-btn-toggle` for the mode, breadcrumb, then the mode.
  `app/components/elements/` has `ElementHeader.vue` and one component per
  model type, chosen through a map from `modelType`.

## Studio API changes

| Change | Reason |
| --- | --- |
| Infrastructure: endpoint types `aasRegistry`, `submodelRegistry`, `aasDiscovery`; `listSource`; probe results with `profiles` per endpoint | Registry and discovery configuration |
| Target capabilities: `listSource`, `search: 'query' \| 'expression' \| 'filter'`, `advancedQuery: boolean`, `assetLookup: boolean` | The UI offers only what the target supports |
| `POST /targets/{targetId}/shell-searches?limit=&cursor=` with `{ expression }` or `{ query }` → `Page<ShellSummary>` and the endpoint used | Server-side search; a POST because queries are JSON |
| `GET /targets/{targetId}/shells?assetId=` (repeatable, `name=value` or a global asset ID) | Discovery lookup |
| `POST /targets/{targetId}/shell-availability` with up to 50 keys → status per key | Row markers |
| `ElementDetail.ancestors: { key, label, modelType }[]` | Deep links and breadcrumb |
| Problems: `query_invalid` (with findings), `query_unsupported`, `descriptor_endpoint_blocked` | Explain refusals |
| `SubmodelRef.status` `blocked` and the row status `blocked` | Descriptor endpoints outside the configured base URLs |

`openapi.yaml` and `endpoints.md` are updated with these changes.

## Definition of done

Run in hosted web (Chromium) and the packaged Electron app against the test
environment, and against the `large` profile where stated:

1. **Infrastructure configuration.** An administrator creates the open target
   with the single-URL shortcut and all six endpoint types, chooses the list
   source, and sees the stored profiles and query support after the probe.
   Invalid combinations (no AAS source, no submodel source, duplicate types)
   are refused with findings.
2. **Registry listing and resolution.** On the open target, the list comes
   from the AAS registry, shells open through their descriptor endpoints, and
   submodels through the submodel registry. The descriptor that points outside
   the configured base URLs is shown as `blocked` and never contacted
   (verified in the network log). The secured target still works from its repositories.
3. **Query search.** On the open target, free text, `field:value`,
   `field=value` and exclusion chips return the matching shells through
   `/query/shell-descriptors` and, with the list source set to repository,
   through `/query/shells`; results page with the cursor; the URL reproduces
   the search. An advanced query runs; an invalid one shows findings, and one
   with a foreign root or `$select` is refused. Without query support the
   client filter and its hint appear. On a workspace target, expressions work
   and the advanced dialog is not offered.
4. **Discovery.** `/targets/{targetId}?globalAssetId=…` opens the matching
   shell; an asset ID with two shells shows a picker; an unknown asset ID says
   so.
5. **Layout.** With the same data, the Studio viewer and the Web UI viewer show
   the same panes in the same order and proportions. Side-by-side screenshots
   are in the results section.
6. **Shell list and details.** On `large`, the list pages through all 2,000
   shells with virtual scrolling, highlights and scrolls to the open shell,
   pins a deep-linked shell that is not loaded yet, shows availability markers
   for rows in view, copies IDs, and shows nothing of the previous target
   after a target switch. The details show asset information, source and
   endpoint origin, collapse, and remember that state.
7. **Tree.** Submodels appear as roots with their status; `forbidden` and
   `blocked` refs cannot be expanded. Levels load on demand. A deep link to an
   element three levels down opens its path and selects it. A value edit
   refreshes the node's preview, also for a submodel resolved through the
   registry.
8. **Right pane.** Every element type in the test fixtures has a typed details
   view; Property and MultiLanguageProperty keep the MVP-2 editor with its
   conflict and permission behaviour. The Nameplate app appears under
   *Visualization* for nameplate submodels only, with the reason. *JSON* shows
   the raw element.
9. **Resizing and small screens.** The tree and the right pane can be resized
   with the mouse and the keyboard within their minimum sizes, the tree can be
   collapsed, and the sizes survive a reload. At 375 px width, a shell can be
   found, opened, and an element's details read and closed. `pnpm lint`
   passes with no style exceptions.
10. **Performance.** On `large`, with a production build: the first list page
    renders within 1 s of the response, scrolling through 2,000 shells has no
    long task over 200 ms, a quick search answers within 2 s, and expanding the
    1,000-entry list renders within 1 s. Measured with Playwright traces;
    budgets are confirmed in phase 0.
11. **Workspace targets.** Criteria 6 to 9 also hold for the desktop workspace
    of `IESEDriveMotorDM3000.aasx`, including the unsaved state after an edit.
12. **Parity list.** Every feature of the Web UI viewer, its infrastructure
    settings, list, search and discovery is listed as done, later (with the
    MVP or prerequisite), or dropped, with a reason.

## Phases

| Phase | Content | Exit |
| --- | --- | --- |
| S. SDK (done) | #549 and #550 in `basyx-typescript-sdk` 2.4.0; Studio updated | SDK 2.4.0 in use |
| 0. Spikes | `@vuetify/v0` splitter in Nuxt SSR and Electron; `v-treeview` with 1,000 and 5,000 nodes; `v-virtual-scroll` with cursor paging; registry integration and query endpoints of `aasenvironment-go` in the test environment; profile detection | Decisions and budgets recorded; ADR drafts |
| A. Infrastructures | Endpoint types, combinations, base-URL policy, list source, stored profiles, admin form with the single-URL shortcut; test environment changes | DoD 1 |
| B. Resolution and discovery | Registry listing and descriptor resolution through `AasService` and `SubmodelService`, availability, discovery lookup, `?globalAssetId=` | DoD 2, 4 |
| C. Search | Shared expression parser, query building and validation, search route, workspace evaluation, search field and dialog | DoD 3 |
| D. Layout and list | `AppBar.vue`, `viewer` layout, drawer, `ViewerSplit`, remembered layout, small screens, `ShellList`, `ShellDetails` | DoD 5–6, 9 |
| E. Tree and right pane | `ancestors`, `SubmodelTree`, element header and type views, *Visualization*, *JSON* | DoD 7–8 |
| F. Wrap-up | Workspace check, performance runs, screenshots, parity list, results, ADRs, `openapi.yaml` | DoD 10–12 |

D and E do not depend on A to C and can start right after phase 0 against
the repository-based targets. B and C use the SDK release from phase S;
C needs B's list source.

### Work breakdown

**S. SDK**

- [eclipse-basyx/basyx-typescript-sdk#549](https://github.com/eclipse-basyx/basyx-typescript-sdk/issues/549):
  query clients for the five `/query/*` endpoints, cursor paging, `$select`
  results.
- [eclipse-basyx/basyx-typescript-sdk#550](https://github.com/eclipse-basyx/basyx-typescript-sdk/issues/550):
  `AAS-3.x`/`SUBMODEL-3.x` endpoint selection in `AasService` and
  `SubmodelService`, and an endpoint hook that gives the caller control over
  the configuration of every descriptor endpoint request, or rejects it.
- Released as 2.4.0 on 2026-10-14 (npm provenance from the repository's
  `publish.yml`, tag `v2.4.0`; dependencies unchanged from 2.3.0). Studio uses
  it with the exact-version exception `basyx-typescript-sdk@2.4.0`; unit,
  integration (129) and type checks pass.

**0. Spikes**

- Add `@vuetify/v0` as a direct dependency pinned to the version `vuetify`
  resolves; `pnpm why @vuetify/v0` still shows one version.
- Splitter prototype: hydration, keyboard resizing, the drag cursor, focus
  visibility, Electron, ESLint rules.
- `v-treeview` with 1,000 siblings and 5,000 loaded nodes. If it misses the
  budget, page the elements endpoint (today it returns a whole level) with
  `limit` and `cursor`, and add a "load more" node; Vuetify's treeview does not
  virtualize.
- `v-virtual-scroll` with infinite loading of cursor pages.
- Test environment: registry integration and `GENERAL_EXTERNALURL` on
  `basyx-open`; check that descriptors carry `AAS-3.2`/`SUBMODEL-3.2`
  endpoints reachable from Studio in dev, the hosted build and Electron; check
  that discovery asset links are filled; run each `/query/*` endpoint once.
- `/description` profiles of `aasenvironment-go` and of the standalone
  services; the rule that derives query support.

**A. Infrastructures**

- `shared/contract/infrastructure.ts`: endpoint types, combination rules,
  `listSource`; probe result with profiles.
- Migration `0002`: `list_source`, `service_profiles` and
  `probed_at` on `infrastructures`.
- `targetPolicy` checks the configured base URLs; `probeEndpoints` stores
  profiles.
- Admin page: new endpoint fields, the single-URL shortcut, list source,
  profiles and query support in the details.
- `test-setup`: registry integration, the foreign descriptor fixture, the
  `large` profile and its generator (`pnpm testenv:fixtures --profile large`),
  updated smoke test.

**B. Resolution and discovery**

- `server/lib/aas/services.ts`; `LiveAasTarget` reads through `AasService`,
  `SubmodelService` and the discovery client; `SubmodelRef.status` `blocked`.
- `shell-availability` route; `?assetId=` on the shell list.
- Unit tests for the base-URL check (scheme, port, path prefix at a segment
  boundary, dot segments, percent-encoding, userinfo, IDN, trailing dots);
  integration tests on both targets.

**C. Search**

- `shared/aas/search-expression.ts`: parser, field table, chips; unit tests
  with the Web UI's cases.
- `server/lib/aas/query.ts`: expression to an SDK `Query`, schema
  validation, root check, size limit, `queryFromJsonable`; `shell-searches`
  route; problems.
- Workspace worker: expression evaluation over package shells.
- `ShellSearchField.vue`, `ShellQueryDialog.vue`, URL state.

**D. Layout and list**

- `AppBar.vue`, `app/layouts/viewer.vue`, `ViewerSplit.vue`,
  `app/stores/viewer.ts`, small-screen behaviour with `useDisplay()`.
- `ShellList.vue`, `ShellDetails.vue`; `targets/[targetId]/index.vue` becomes
  the viewer with no shell open.
- Vuetify defaults and aliases for recurring viewer pieces in
  `vuetify.config.ts`; i18n keys for all new labels.

**E. Tree and right pane**

- `ancestors` in `server/utils/elements.ts` from the parsed locator, with
  tests for operation variable groups and list indices.
- `SubmodelTree.vue` (remove `ElementTree.vue`), `ElementPane.vue`,
  `app/components/elements/*`, shared field components; app views move to
  *Visualization*.

**F. Wrap-up**

- Web e2e: `test/e2e/web/viewer.spec.ts`, `search.spec.ts`,
  `infrastructures.spec.ts`; performance traces on `large`; desktop e2e for
  the workspace. Update the e2e tests that use the old shell page.
- ADRs, results section, code map, parity list, `openapi.yaml`, AGENTS.md note
  on headless `@vuetify/v0` components.

## ADRs to write

- ADR 0020: registries, discovery and descriptor endpoints (endpoint types,
  list source, resolution through the SDK services, the base-URL rule, no URL
  rewriting).
- ADR 0021: AAS Query Language through the BFF (expression syntax, validation,
  root restriction, support detection, workspace evaluation).
- ADR 0022: viewer layout and headless `@vuetify/v0` components where Vuetify
  has no styled component, styled only with Vuetify utilities.

## Known risks

| Risk | Mitigation |
| --- | --- |
| Registries publish internal host names (for example Docker service names) instead of the configured URLs | Shown as `blocked` with the URL's origin, not silently replaced; the deployment guide names `GENERAL_EXTERNALURL`; URL rewriting stays out of scope until a real deployment needs it |
| Query profile URIs differ between servers and versions | Profiles plus the first-use check; a wrong guess degrades to the client filter |
| `AasService` and `SubmodelService` do not fit every Studio path (for example availability checks or per-row resolution) | Use the SDK clients directly for those paths, still through the endpoint hook and the guarded fetch |
| A per-request descriptor lookup slows down opening shells and loading submodels | Measure on `large`; cache descriptors per target and session for a short time if needed |
| `@vuetify/v0` is young (1.x) and its API may change | Pinned to the version `vuetify` itself depends on; used only inside `ViewerSplit.vue` |
| The splitter's handle needs a drag cursor or hover state that Vuetify utilities cannot express | Check in phase 0; decide in ADR 0022 between a Vuetify class, a v0 data attribute, or one documented exception |
| `v-treeview` does not virtualize, so large levels are slow | Budget in phase 0; paging with a "load more" node if needed |
| Moving app views to *Visualization* changes MVP-3 URLs | `?view=` is mapped on load |
| The scope is larger than earlier MVPs | Phases are independent where possible; the parity list records what moves to later slices |

## Out of scope

AAS, submodel and element creation, editing beyond the MVP-2 value editor,
deletion, upload and download on live targets, discovery and registry writes,
QR scanning, submodel search on global submodel routes, per-endpoint
credentials, URL rewriting for descriptor endpoints, Catena-X and EDC access,
the company lookup service, concept descriptions, file previews and thumbnails,
UML view, operation invocation, automatic value refresh (the Web UI's auto
sync), the command palette, and the Web UI's editor, submodel viewer and
submodel editor routes.

## After MVP-4

- File streaming (`/targets/{targetId}/files`) with the core file previews
  (PDF, image, CAD, IFC, JSON, XML) and thumbnails.
- Concept descriptions in the details header.
- First-party submodel apps from the classification (TechnicalData,
  HandoverDocumentation, CarbonFootprint, …) in *Visualization*.
- QR scanning through discovery.
- Editing: create, edit and delete elements, submodels and shells (AASEditor
  parity) on the MVP-2 revision path, with registry and discovery
  synchronization where the server does not integrate them.
