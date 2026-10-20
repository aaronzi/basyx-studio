# External apps plan: published SDK, signed packages and a pilot app

- Status: Proposed
- Date: 2026-10-20
- Depends on:
  - the app platform of [MVP-3](mvp-3-plan.md) (implemented);
  - WebAssembly, workers and file reads for app frames
    ([ADR 0038](../adr/0038-webassembly-workers-and-file-reads-for-apps.md));
  - connections on infrastructures from the
    [time series plan](time-series-plan.md) (implemented);
  - parts of [MVP-7](mvp-7-plan.md), which this plan orders (see
    [Relation to MVP-7](#relation-to-mvp-7)).
- Scope decision gate:
  - an app is developed, built, signed and released in a repository other than
    Studio's, against published packages only;
  - Studio installs and updates such an app without developer mode, and an
    administrator can tell who signed it;
  - an existing multi-page AAS application, today a module of a forked AAS web
    UI, runs as a Studio app and replaces the fork and its separate image.
- Requirements: APP-001, APP-006, APP-009, APP-011, APP-015, APP-017,
  APP-020, APP-022, APP-023, SAP-002, SAP-003, SAP-006, CON-002, CON-004
  ([requirements](../requirements.md))

## Goal

Studio's app platform works for the apps in this repository. A team outside
it cannot use it yet:

- the SDK is TypeScript source consumed through workspace links;
- the helpers every bundled app uses are bound to this repository's files;
- installing needs developer mode, and an installed app cannot be updated;
- nothing says who built a package.

This plan makes Studio a platform for external apps first and proves it with a
pilot.

> a team keeps its app in its own repository → its CI runs
> `pnpm add -D @basyx/studio-sdk @basyx/studio-app-kit`, builds, runs
> `studio-app pack` and signs the package with the team's key → the operator
> adds the team's public key to Studio's trust store and mounts the package →
> Studio verifies the signature and installs the app → the next release
> replaces it in place; links and audit records keep the same installation.

The pilot is an existing application with about ten pages, now a module of a
forked AAS web UI. The fork has to be rebased onto every upstream release and
shipped as its own image. As a Studio app, it needs neither.

## Starting point

- **SDK:** `@basyx/studio-sdk` 0.1.0 exports `src/*.ts`
  (`packages/studio-sdk/package.json`). It is consumed as `workspace:*` only.
  No workflow publishes it. `connect()` rejects outside a frame, so an app
  cannot run in a plain dev server or in unit tests.
- **App helpers:** `apps/shared` (`mountApp`, Vuetify defaults, theme sync,
  i18n, the Vite plugin that compiles Vuetify with Studio's Sass settings and
  patches embind) imports from `app/` and `shared/`. `@basyx/model-viewer`
  (three, web-ifc, occt) is private.
- **Packaging:** `scripts/build-example-apps.mjs` builds and zips the apps in
  this repository. There is no tool for other repositories.
- **Integrity:** SHA-256 digests of the package and of each file, checked when
  served (ADR 0016). Uploaded packages are labelled `unsigned`. There are no
  signatures, keys or publishers in code; ADR 0004, `app-platform.md` and
  APP-011 defer them to the marketplace.
- **Installation:**
  - uploads need `STUDIO_APPS_ALLOW_UNSIGNED=true` and install without a
    consent step (`AppsPanel.vue`);
  - installing an app ID that is installed fails: "Uninstall it first; updates
    come with the marketplace" (`server/lib/apps/store.ts`);
  - reinstalling creates a new installation ID, which breaks deep links;
  - only bundled apps are updated in place, by digest at startup.
- **Capabilities for an app like the pilot:**
  - reads of shells, submodels and attachments work (`studio.aas.*`,
    `studio.ui.readFile`);
  - `studio.aas.listShells` has no filter, so an app filters by asset type
    itself;
  - `studio.timeseries.read` is reserved for bundled apps
    (`server/lib/apps/calls.ts`), and a LinkedSegment is read for the given
    range only, with no "latest" anchor;
  - the app CSP has `connect-src` and `img-src` for the app's own files and
    `frame-src 'none'` (`server/lib/apps/csp.ts`);
  - no structural writes, no attachment uploads.

## What the pilot needs

| Need | Today | Covered by |
| --- | --- | --- |
| About ten pages with deep links | One module, internal routing over `subPath` (path segments only, no query) | Works today. Stable links need in-place updates (U5). Root URLs need single-app mode. |
| Shells of one asset type and their related shells | `listShells` and client-side filtering | Works today; AASQL (MVP-7 A3) makes it cheaper |
| Submodels and attachments (images, documents) | `getSubmodel`, `readFile` | Works today |
| IFC model from Handover Documentation | Works in a frame (models-3d), but the viewer package is private | P1 (publish the viewer) |
| Bill of material graph | Bundled BoM viewer, but apps cannot embed other apps' views | The pilot opens Studio's shell page (X2) |
| File management on a FileSystem submodel (upload, rename, move, delete) | Read only; no FileSystem view in Studio | A bundled FileSystem view (X3) on MVP-7 A1, A2 |
| A public third-party REST API | Blocked: no `connect-src`, no backend network | MVP-7 K1–K9 |
| Latest values from InfluxDB | Bundled apps only; no "latest" for LinkedSegments | T1, T2 |
| Embedded third-party pages (dashboards, 3D captures) | Blocked: `frame-src 'none'` | Replaced by charts over TimeSeries submodels (X1) |
| Product brand, no Studio frame | — | Not needed for the pilot; MVP-7 single-app mode later (X4) |
| No credential in the browser | The current module puts a database token into its bundle | Connections (already implemented) |

## Decisions

Decided on 2026-10-20.

### Published packages

| # | Topic | Proposal |
| --- | --- | --- |
| P1 | Packages | Three packages, published from this repository. `@basyx/studio-sdk`: built ESM with type declarations, `protocol`, `backend` types, the manifest schema and `testing` (P5). `@basyx/studio-app-kit`: what is now `apps/shared` (`mountApp`, Vuetify defaults, theme sync, i18n helper) plus a Vite preset with Studio's Sass settings and the embind patch, and the `studio-app` command (P4). `@basyx/model-viewer`: the 3D viewer, made public. |
| P2 | One source | `apps/shared` moves to `packages/studio-app-kit`. Studio's Sass settings and `shared/vuetify-defaults.ts` are copied into the kit at build time, so Studio and the apps keep one source. Bundled apps import the kit like any external app. |
| P3 | Release | A GitHub Actions workflow publishes on tags `sdk-v*`, with pnpm and npm trusted publishing (provenance). The packages are versioned together and independently of Studio, as `0.x` until the app API is stable. The README has a table: package version → app API version (`studioAppApiVersion`) → first Studio release. |
| P4 | Command | `studio-app pack` validates `studio-app.json` against the schema and the checks of `server/lib/apps/manifest.ts` (shared code), applies the package limits of ADR 0016, and writes `<id>-<version>.zip`. `studio-app sign --key` writes the signature of U1. `studio-app verify` checks both. |
| P5 | Test transport | MVP-7 D1 and D2 move here: `StudioClient` on a `Transport` interface, and `@basyx/studio-sdk/testing` with `createTestStudio({context, handlers})`. Apps run in a plain Vite dev server and in unit tests. Neither changes the protocol, so the app API stays at 0.1.x. |
| P6 | Proof | One example in `examples/apps/` is built in CI from the packed tarballs of the three packages, not from workspace links, so anything that still reaches into this repository fails the build. |
| P7 | Lint preset | Could: `@basyx/studio-app-kit/eslint` exports the Vuetify rules of `eslint.config.js` (no custom CSS, no restated defaults, button groups) with the kit's defaults, for teams that want Studio's look. Studio enforces nothing about an app's UI at runtime. |

### Signatures, trust and updates

| # | Topic | Proposal |
| --- | --- | --- |
| U1 | Format | A detached signature over the exact package bytes: ECDSA P-256 with SHA-256, base64, as written by `cosign sign-blob --key`. `studio-app sign` writes the same format, so a team can use either tool. The file is `<package>.zip.sig`. Keyless signing (Fulcio, Rekor) is not used: it ties signing to a public identity provider, which self-hosted CI often is not. |
| U2 | Trust store | `STUDIO_APPS_TRUSTED_PUBLISHERS` names a YAML file: `publishers: [{ name, keys: [PEM or file path], appIds: ['org.example.*'], permissions: [] }]`. A key signs only app IDs matching its `appIds` patterns. The file is read at startup, like declared infrastructures. Desktop keeps accepting unsigned packages and gets the trust store later. |
| U3 | Verification | Studio verifies on upload, on update and for every managed package at startup: signature over the bytes, key in the trust store, app ID within the key's patterns. The installation records `trust` (`bundled`, `signed`, `managed`, `unsigned`), the publisher name from the trust store and the key fingerprint. This replaces the `unsigned` column. The manifest's `publisher` stays the app's claim; the *Apps* page shows the trust-store name as "Verified publisher". |
| U4 | Uploads | Signed packages install without `STUDIO_APPS_ALLOW_UNSIGNED`. The upload takes the signature in a `Studio-App-Signature` header; the *Apps* page takes both files. A bad signature is refused, also when unsigned packages are allowed. |
| U5 | Updates | Installing an app ID that is installed updates it in place and keeps the installation ID, as bundled apps do now. Allowed when the new package is signed by a key of the same trust-store publisher, or is managed, or both versions are unsigned in developer mode. The version must be higher; managed packages may go back, because the operator vouches. A running backend is stopped and starts with the new files on the next call. |
| U6 | Consent | Upload becomes two steps. `POST /app-installations?inspect=true` returns the manifest, the verification result and, for an update, the changed permissions, sandbox flags and connections. The dialog shows them and installs on confirmation. New permissions on an update need this confirmation too. Managed packages are approved by the operator's configuration. |
| U7 | Reserved permissions | A trust-store entry may grant reserved permissions to its apps: `permissions: [studio.timeseries.read]`. `studio.containers` stays reserved for bundled apps (ADR 0033). |
| U8 | Revocation | A key removed from the trust store revokes its apps at the next start: their frames and calls are refused, and the *Apps* page says why. A newly signed package restores them. There are no revocation lists. |
| U9 | Managed packages | MVP-7 M2 moves here, because it shares the install path. `STUDIO_APP_PACKAGES` picks up `<package>.zip.sig` next to each package. Unsigned managed packages stay allowed (`trust: managed`); a signature that is present must verify. |

### Capabilities the pilot adds

| # | Topic | Proposal |
| --- | --- | --- |
| T1 | Latest values | `anchor: 'latest'` also works for LinkedSegments: the InfluxDB adapter asks for the last point per series before the range end and moves the range to it, within the Flux guard. |
| T2 | Time series for installed apps | `studio.timeseries.read` is allowed for apps whose trust-store entry grants it (U7). The time series plan's "installed apps with an install warning" is covered by the consent step (U6). |

### Pilot decisions

| # | Topic | Decision |
| --- | --- | --- |
| X1 | Embedded third-party pages | Studio keeps `frame-src 'none'`. Dashboards that the pilot embeds today become charts in the pilot, over TimeSeries submodels read with `studio.timeseries.read` (T1, T2). Other third-party pages become links through `studio.ui.openExternal`. A `sandbox.frameOrigins` extension is not planned; pages that need their own sign-in would not work inside an opaque-origin frame anyway. |
| X2 | Bill of material and other existing views | The pilot does not reimplement Studio's submodel views. It opens Studio's shell page with `studio.ui.openShell({shellId})` (MVP-7 M6, taken here for full Studio), where the bundled views show the submodels. Apps embedding other apps' views is the follow-up (see [Later](#later)). |
| X3 | FileSystem view | A bundled Studio app for the FileSystem submodel (`https://basyx.org/FileSystem/FileSystem/0/1`): a folder tree, preview, upload, rename, move and delete in edit mode. It uses MVP-7 A1 and A2, so it is their first consumer. The pilot reaches it as in X2. |
| X4 | Delivery | The pilot runs as an app in a full Studio. Single-app mode stays with MVP-7 and is not a condition of this plan. The package will run unchanged in it (SAP-002). |

## Code structure

- **`packages/studio-sdk/`:** a build step to `dist/` (ESM and declarations),
  `exports` to `dist`, `Transport`, `testing.ts`.
- **`packages/studio-app-kit/`:** from `apps/shared`, plus the Vite preset and
  `bin/studio-app` (`pack`, `sign`, `verify`). Manifest checks are shared with
  `server/lib/apps/manifest.ts`.
- **`packages/model-viewer/`:** made public, with a build step.
- **`server/lib/apps/`:**
  - `signature.ts`: signature verification (`node:crypto`, no new dependency);
  - `trust.ts`: the trust store, key patterns and reserved permissions;
  - `store.ts`: in-place updates, the `trust` state, inspection;
  - `packages.ts`: managed packages (U9);
  - `calls.ts`: reserved permissions from the trust store (U7).
- **`server/database/migrations/`:** `trust`, `publisher` and
  `key_fingerprint` on `app_installations`, replacing `unsigned`.
- **`server/lib/timeseries/`:** the latest anchor for LinkedSegments (T1).
- **`apps/file-system/`:** the bundled FileSystem view (X3).
- **`app/composables/useAppBridge.ts`:** `studio.ui.openShell` (X2).
- **`server/lib/config.ts`:** `STUDIO_APPS_TRUSTED_PUBLISHERS`,
  `STUDIO_APP_PACKAGES`.
- **`app/components/AppsPanel.vue`:** the two-step upload with consent,
  updates, trust labels and revoked apps.
- **`.github/workflows/sdk-release.yml`:** publication (P3).
- **`examples/apps/`:** the example built from tarballs (P6).
- **`examples/deployment/signed-app/`:** Compose with a trust store, a mounted
  signed package and a guide for signing in another repository's CI.

## Phases

| Phase | Content | Done when |
| --- | --- | --- |
| A | ADRs: published SDK and app kit; signatures, trust store and updates (amends ADR 0004 and ADR 0016, takes MVP-7 M2). Requirement changes. This plan's ADRs are 0043 (published SDK and app kit) and 0044 (signatures, trust store and updates), so MVP-7's planned ADRs start at 0045. | ADRs reviewed |
| B | Packages P1–P6: build, app kit, `studio-app` command, test transport, release workflow, the tarball example. Bundled apps move to the kit. | The packages are on npm with provenance. An app in an empty repository builds, packs and runs in a plain dev server against the test transport. All bundled apps work unchanged. |
| C | Signatures, trust and updates U1–U9, with the migration and the consent dialog | A signed package installs without developer mode and updates in place with the same installation ID. A package signed by an unknown key, or by a key outside its app ID pattern, is refused. Removing the key revokes the app. |
| D | Pilot, read-only: the pilot's repository builds against the published packages; its pages that only read AAS run in the test transport and in Studio; its CI packs and signs. Runs in parallel with C as soon as B is done. | The read-only pages run in a Studio started from the Compose example, from a signed package built outside this repository |
| E | Capabilities: MVP-7 K1–K9 (HTTP connections), A1 and A2 (structural writes and attachments), T1 and T2, `studio.ui.openShell` (X2), and the bundled FileSystem view (X3) | The pilot calls its third-party API through a connection and shows charts from `studio.timeseries.read` instead of embedded dashboards. Files are managed in the FileSystem view on Studio's shell page. No credential reaches the browser. |
| F | Report: what the pilot still misses, and the end of the forked web UI image | A follow-up plan lists the remaining gaps |

## Relation to MVP-7

This plan runs before the rest of MVP-7 and takes parts of it:

- **D1, D2** (transport, test transport) move to phase B. D3 and D4 stay with
  MVP-7, because D4 raises the app API with MVP-7's new methods.
- **M2** (managed packages) moves to phase C, because signed uploads, updates
  and managed packages share one install path.
- **K1–K9, A1, A2** are done in phase E, in MVP-7's form.
- **`studio.ui.openShell`** from M6 is done in phase E for full Studio. Its
  single-app behaviour (`STUDIO_APP_STUDIO_PAGES`) stays with MVP-7.
- **MVP-7 phase G**, "port an existing multi-service AAS application outside
  this repository", is this plan's pilot. It is done when this plan's
  phase F is.

Single-app mode, A3–A5 and the sandbox extensions S1–S3 stay with MVP-7.

## Later

- Apps embedding other apps' submodel views (X2), so the pilot can show the
  BoM, FileSystem and Time Series views in its own pages. This is the first
  follow-up.
- A marketplace with OCI artifacts, keyless signatures, SBOM and review status
  (APP-013). U1's format is what `cosign` writes, so OCI signatures can follow.
- A trust store on desktop.
- Revocation lists distributed to deployments.
- Hot reload of a dev server inside a real Studio frame.
