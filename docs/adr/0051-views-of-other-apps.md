# 0051: Views of other apps in Studio's dialog and inline

- Status: Proposed
- Date: 2026-10-21
- Deciders: BaSyx Studio maintainers
- Amends: the frames and Content Security Policy of
  [ADR 0017](0017-app-origin-and-content-security-policy.md) and
  [ADR 0045](0045-app-origins-embeds-and-full-page-modules.md), for embedded
  views only; the UI methods of
  [ADR 0018](0018-capability-bridge-and-authorization.md)
- Decides: E1–E4 of the
  [external apps follow-up plan](../development/external-apps-follow-up-plan.md)
- Requirements: APP-026, APP-006, APP-009, APP-010, SEC-005

## Context

Studio's shell page shows every submodel in the views of the installed apps:
the bundled Bill of Material, Files and Time Series views, and those of other
apps. Each view runs in a frame of its own installation, with its own
manifest's permissions and the user's rights (ADRs 0017, 0018).

An app with pages of its own, such as a full-page module (ADR 0045), wants to
show a shell's bill of material, documents or time series too. Today it calls
`studio.ui.openShell` (app API 0.1.4), which leaves the app for Studio's shell
page; going back returns to it, but the app's page is loaded again. Building
the same views into every app would duplicate the bundled ones, and their
chart library (ADR 0041) and PDF renderer (ADR 0050) with them.

A view of another app has to stay that app's: it acts with its permissions,
and the app that shows it must not get them. Three things would hand them
over:

- **The port.** Whoever holds a view's MessagePort calls methods as that
  view's installation. The port must reach the view's document only.
- **The document.** A document of the same origin as the view can script
  it, and so use its port. With a shared apps origin all frames are opaque,
  and Studio cannot tell one opaque frame from another by origin.
- **The clicks.** A page that contains a frame decides where it is, how large,
  how transparent, and what lies over it. It can make the user click a
  button in the view without seeing it (clickjacking). The view would then
  write, or open a page, with its permissions and the user's rights.

## Decision

### E1: `studio.ui.openView` shows a view in Studio's dialog

```ts
studio.ui.openView(submodelId: string, options?: { shellId?: string, appId?: string, viewId?: string }): Promise<null>
// protocol: 'studio.ui.openView': { params: { submodelId, shellId?, appId?, viewId? }, result: null }
```

- **Which view.** Studio reads the submodel of the frame's target as the user
  and picks a view for its semantic ID as the shell's *Overview* does: of the
  matching views, the apps shipped with Studio first, then the installed
  ones in installation order. `appId` picks the first matching view of that
  app, `viewId` (the contribution ID in its manifest) one of its views. Apps
  name other apps by app ID because installation IDs differ per deployment.
  A view of the calling app itself is allowed.
- **Which shell and submodel.** A submodel of the frame's target, by ID. With
  `shellId`, the shell must reference it (as for `openShell`), and the view's
  context has that shell; without, the view's `context.shell` is `null`, as
  in Studio's submodel view. The context's submodel is the one opened, with
  the semantic ID Studio read.
- **Studio's dialog.** The view shows in a full-screen dialog over the
  calling frame, with the view's title, the app and the submodel in Studio's
  header and a close button. The view is a frame of its own installation, at
  its origin, with its contribution, permissions and the user's rights, as on
  the shell page. Its `context.fullscreen` is `true`, as in its own full-screen
  dialog, and `context.mode` is Studio's mode: Studio draws the dialog and
  everything over it, so the clicks in it are the user's. Closing it returns
  to the calling frame, which stayed mounted underneath: the app's page, its
  state and the URL do not change.
- **What the calling app learns.** `null`, and `context.fullscreenOpen` is
  `true` until the user closes the dialog (as for `openFullscreen`, app API
  0.1.7), so the app can reload what the view may have changed. It does not
  learn the view's app, installation or title. Refusals tell it whether a view
  exists: `unsupported_operation` when no installed app has a view for the
  submodel's semantic ID (or `appId` has none, or the submodel has no
  semantic ID), so it can call `openShell` instead; `target_resource_not_found`
  when the shell does not reference the submodel; the target's problems
  (`target_forbidden`, …) when the user cannot read it.
- **Permission.** `studio.ui.navigation`, like `openShell`. The opened view
  needs none from the caller; its own manifest's permissions apply.
- **User activation.** It needs a click or key press in the app just before,
  like `openShell`: it covers the app's page, which a timer or a page load
  should not.
- **Where.** From frames on Studio's page: modules and submodel views, on
  targets and AASX workspaces, hosted and desktop. A frame inside a dialog
  (a full-screen view, or a view opened this way) cannot open another one
  (`unsupported_operation`), so dialogs do not stack. A frame not bound to a
  target gets `invalid_request`. Backends cannot call it.
- **Server and page.** Studio's server authorizes the call, reads the
  submodel (and the shell) as the user and picks the view; only Studio's
  page receives which one, and answers the app with `null`.

### E2: `studio.ui.embedView` places a view in the app's page

```ts
studio.ui.embedView(submodelId: string, options?: { shellId?: string, appId?: string, viewId?: string }): Promise<{ url: string }>
// protocol: 'studio.ui.embedView': { params: { submodelId, shellId?, appId?, viewId? }, result: { url: string } }
```

- **The same view, checks and permission** as `openView`; no click is needed,
  since an inline view loads with the page, as on the Overview.
- **Only with an origin per installation** (ADR 0045,
  `STUDIO_APPS_URL=https://{installation}.apps.example.org`). With the shared
  apps origin the call is refused (`unsupported_operation`), and the app uses
  `openView`: an opaque frame of the view cannot be told apart from the
  embedding app's own frames. Desktop gives each installation an origin too
  (`studio-app:`); it refuses `embedView` until Electron's frame rule and the
  scheme's policy sources are tested with it.
- **Placement.** The app creates the frame itself, `<iframe :src="url">`, in
  its own page, and gives it its size. Studio does not tell it the view's
  content height. The frame must keep the view's origin: no `sandbox`
  attribute, or one with `allow-scripts allow-same-origin`.
- **The URL** is the view's entry at its installation's origin with a token
  (`?studio-embed=…`) that Studio's server signs, like capability tokens
  (ADR 0019): the view installation, its entry, the embedding installation's
  origin, an expiry of one hour and a random value, so that every embed has
  a token of its own. The server serves that document with
  `frame-ancestors` of Studio's origin and the embedding app's origin; every
  other document keeps `frame-ancestors` of Studio's origin only. The
  embedding app's documents get the apps origin pattern
  (`https://*.apps.example.org`) in `frame-src` when it declares
  `studio.ui.navigation`.
- **The connection bypasses the embedding app.** The SDK in the view sees the
  token and posts its `hello`, with the token, to Studio's page
  (`window.top`) instead of its parent. Studio's page connects it only if the
  token is one it handed to that embedding frame, the message comes from the
  view's origin, and its window is inside the embedding frame. It posts the
  port to the view's origin only. The embedding app never sees the port or
  the context, and cannot script the view's document, which has another
  origin. The SDK repeats its hello until it is answered, and each hello
  carries a random value per document (`instance`): one document gets one
  port, and a document that loads again gets a new one, which closes the
  old. Before it connects, Studio's page reads the view's current package
  and its own app's settings and connection status on the target
  (ADR 0048); the embedding app's never reach it. When the embedding frame
  reloads or is removed, Studio closes the ports of its embedded views.
- **Updates in place** (ADR 0044). When the view's app is updated, its next
  call is refused as `app_outdated`, and Studio's page loads the embedded
  view again at its URL; it connects with the new package. A URL older than
  an hour does not load any more; the app asks for a new one.
- **Embedded views are read-only.** The embedding app controls the frame's
  position, size, transparency and what lies over it, so it could steer the
  user's clicks into the view. Studio's page therefore gives an embedded view
  `context.mode: 'view'` and `context.embedded: true` always, and lets it
  call only reads (`aas.listShells`, `getShell`, `listSubmodels`,
  `getSubmodel`, `getSubmodelSnapshot`, `getElement`, `timeseries.read`,
  `ui.readFile`, `ui.readExternalFile`) and `ui.notify`, as its permissions
  allow. Everything else is refused with `forbidden`: writes, the methods
  that need a click or act outside its frame, and those that could write
  further away, its backend (`backend.call`) and its connections'
  operations (`connections.call`). The list is an allowlist, so methods
  added later stay refused until they are added to it. `openFullscreen`
  opens the view in Studio's dialog, as `openView` does, where it runs with
  Studio's mode again, and the embedded view's `context.fullscreenOpen` is
  `true` until it closes; in a frame that is itself in a dialog, it is
  refused with `unsupported_operation`. `setHeight` has no effect.
- **What the embedding app learns:** the URL, whose host names the view's
  installation ID but not its app ID or data. It cannot read the view's
  pixels, document or messages.
- **Views built for it.** Only an SDK that knows the token connects from
  inside another app; an older view would say hello to the embedding app,
  which must not answer for Studio. Studio embeds the views shipped with it,
  which are built with the current SDK, and views whose manifest's
  `studioApi` excludes app API versions below 0.1.11; it picks among those
  as for `openView` (`unsupported_operation` when none fits).

### E3: no chart component in the app kit

`@basyx/studio-app-kit` gets no chart component. A chart library in the kit
would set one library and version for every app, which ADR 0041 avoided for
Studio itself by keeping ApexCharts in the Time Series app. Apps chart the
results of `studio.timeseries.read` with a library of their choice, or show
the Time Series view with `openView` or `embedView`. This is revisited when a
second app needs the same chart in its own pages.

### E4: no support for embeds that need a sign-in

Nothing changes for embedded third-party pages that need the third party's
sign-in. ADR 0045 and the SDK README say that they may not work: the embedded
page is a third-party context, browsers block or partition its cookies, and
forms and popups are off. Apps open such pages with `studio.ui.openExternal`.
The Storage Access API (`requestStorageAccess`, which needs
`allow-storage-access-by-user-activation` in the frame's sandbox) or sign-in
popups (`allow-popups`) would each need their own decision on sandbox flags.

### Versions

- `openView` is an optional method: the app API becomes **0.1.10**, and
  `@basyx/studio-sdk`, `@basyx/studio-app-kit` and `@basyx/model-viewer`
  **0.1.9** (`@basyx/studio-sdk/testing` records opened views in
  `openedViews` and sets `context.fullscreenOpen`). An app that calls it
  declares `"studioApi": "^0.1.10"`; an older Studio refuses the call as an
  unknown method.
- `embedView`, `context.embedded` and the hello's `embed` token are optional
  additions too: the app API becomes **0.1.11**, and the packages
  **0.1.10** (`@basyx/studio-sdk/testing` records embedded views in
  `embeddedViews`). Embedding apps and embeddable views declare
  `"studioApi": "^0.1.11"`.

## Consequences

- Apps show the bundled and installed views of a submodel without leaving
  their page and without building them again; the user returns to the same
  page, in the same state.
- A view keeps its permissions in every place it is shown. The calling app
  gains nothing but the knowledge that a view exists for a semantic ID, and,
  with E2, the installation ID in the frame's URL.
- Views in Studio's dialog can edit as on the shell page. Embedded views
  cannot: changes are made in Studio's dialog or on the shell page.
- E2 needs an origin per installation; deployments with the shared apps
  origin offer the dialog only. Views must be built with a recent SDK to be
  embedded.
- `studio.ui.navigation` now also covers showing other apps' views; the
  *Apps* page and the consent dialog say so.

## Alternatives considered

- **Building the views into the app kit.** Every app would carry the bill of
  material's graph library, the chart library and PDF.js, in its own version,
  and the bundled apps' fixes would not reach them.
- **Installation and contribution IDs to name a view.** Installation IDs
  differ per deployment, so a signed package could not name one. App IDs
  are stable.
- **Resolving `openView` when the dialog closes.** A call would stay open for
  as long as the user looks at the view; `context.fullscreenOpen` already
  tells views when their own dialog closes, and apps use one pattern for both.
- **Handing the embedding app the view's port, or relaying its messages.**
  The app would hold the view's permissions, or could forge and read its
  calls.
- **Studio drawing the inline view over the app's frame** at a place the app
  reports. Studio would control the clicks, but the view would not scroll,
  clip or layer with the app's page, and menus of the app would open under
  it.
- **Writable embedded views with visibility checks.** Browsers do not tell a
  frame reliably that it is fully visible (IntersectionObserver v2 is
  Chromium only and reports only some cases), so clickjacking could not be
  ruled out.
- **`frame-ancestors` of every apps origin for every app document.** Any app
  could frame any other app's documents, whose SDK would say hello to it,
  and play Studio for them, e.g. to fill their storage. The signed token
  relaxes it for one document and one embedding origin.
- **Inline views on the shared apps origin** with a token alone: Studio
  could not check the origin of the hello, and the embedding app could
  answer for the view in an opaque frame of its own.
