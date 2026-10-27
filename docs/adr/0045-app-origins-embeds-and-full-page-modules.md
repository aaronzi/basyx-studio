# 0045: One origin per app installation, declared third-party origins and full-page modules

- Status: Proposed
- Date: 2026-10-20
- Deciders: BaSyx Studio maintainers
- Amends: the frames, apps origin and Content Security Policy of
  [ADR 0017](0017-app-origin-and-content-security-policy.md); the manifest
  `sandbox` of [ADR 0038](0038-webassembly-workers-and-file-reads-for-apps.md)
- Reverses: X1 of the [external apps plan](../development/external-apps-plan.md)
  ("a `sandbox.frameOrigins` extension is not planned") and the last sentence
  of S2 of the [MVP-7 plan](../development/mvp-7-plan.md) ("nothing extends
  `connect-src`")
- Takes over: S1–S3 of the MVP-7 plan (image and media origins)
- Requirements: APP-008, APP-010, APP-011, APP-019, APP-022, APP-024

## Context

Every app frame runs with `sandbox="allow-scripts"`, so its document has an
opaque origin, and its policy has `frame-src 'none'` and `connect-src` for the
app's own files only (ADR 0017). All installations share one apps origin,
`STUDIO_APPS_URL`; the opaque origin is what keeps them apart.

Porting an existing multi-page AAS application to a Studio app (phase D of
the external apps plan) showed what this rules out:

- **Embedded third-party pages**, e.g. a public 3D-capture viewer or a public
  dashboard. A `frame-src` allowlist alone does not help. A nested frame
  inherits the sandbox flags of the app frame, so the embedded page runs in an
  opaque origin too. In headless Chromium, a public 3D-capture viewer page in
  a frame sandboxed like an app frame stays blank: it reads `document.cookie`,
  gets a `SecurityError` ("the document is sandboxed and lacks the
  'allow-same-origin' flag"), and its client app stops. In an unsandboxed
  frame it renders. Pages that use `localStorage` fail the same way.
- **Keyless public APIs** read by the browser, e.g. a weather API. HTTP
  connections (MVP-7 K1–K9) are for services with secrets, per-deployment
  endpoints and audited calls. A public API needs none of this, and routing it
  through Studio's server costs a connection per deployment.
- **Pages without Studio's header.** A module page always shows a breadcrumb
  header and puts the frame in a card inside a padded container. An
  application with its own navigation, a map or a 3D scene wants the whole
  page.

`allow-same-origin` would give embedded pages their own origin. With one
shared apps origin it would also put every installation in the same origin,
where one app can read another's storage and script its frames.

## Decision

### One origin per installation

- `STUDIO_APPS_URL` may name the installation as the first label of its host:
  `https://{installation}.apps.example.org`. Each installation then has its
  own origin, e.g. `https://app-0123456789abcdef.apps.example.org`. Files stay
  under `<base path>app/<installation>/<path>`, so the route, the reverse
  proxy rule and the URLs keep their shape. The installation ID (`app-` and 16
  hex digits) is a valid DNS label.
- Studio routes by `Host`. A host of the pattern answers only for
  `/app/<installation>/` of its own installation. Every other path, and every
  other installation's files, answer 404. The Studio host still answers 404 for
  `/app/`. Studio refuses to start when the pattern could match its own host.
- A `STUDIO_APPS_URL` without `{installation}` keeps the shared origin of
  ADR 0017, unchanged.
- **Desktop already has one origin per installation:**
  `studio-app://<installation>/` (ADR 0017). It is treated like the pattern.
- **Development:** `http://{installation}.apps.localhost:3000`. Chromium
  resolves every name below `.localhost` to loopback, including subdomains of
  subdomains such as `app-0123456789abcdef.apps.localhost` (checked with
  Chromium 156; other browsers were not checked). Other programs may not:
  Node.js, curl and container DNS often do not resolve these names. Only the
  browser needs to.
- **Hosted:** a wildcard DNS record and a wildcard TLS certificate for the
  apps domain, e.g. `*.apps.example.org`. ACME issues wildcard certificates
  only with the DNS-01 challenge. The reverse proxy routes the wildcard host to
  Studio and keeps the `Host` header. A registrable domain of its own for apps
  (e.g. `example-apps.net`) is preferred: script on a subdomain of Studio's
  domain can set cookies for the parent domain. Studio's session cookie has the
  `__Host-` prefix on https, so it cannot be overwritten that way, but other
  services of the domain may not be as careful.

### The app frame

- With an origin per installation (the pattern, or desktop), the frame gets
  `sandbox="allow-scripts allow-same-origin"`, and the policy of every app file
  has `sandbox allow-scripts allow-same-origin`. With the shared origin, both
  stay `allow-scripts`. Forms, popups, modals, downloads, top navigation,
  pointer lock and presentation stay off in both cases.
- The contribution carries the frame's origin (`frameOrigin`, `null` when
  opaque). The host bridge posts its `connect` message, with the port, to that
  origin instead of `*`, and accepts the `hello` only from it. A frame that
  navigated elsewhere before saying hello never receives a port.
- Hosted, app files are also served with `Origin-Agent-Cluster: ?1`.
  Sandboxed documents cannot set `document.domain` anyway; the header keeps
  it that way if a browser treats it differently. Desktop leaves it out:
  under the `studio-app:` scheme, it makes Electron 44's main process stop.
- `Access-Control-Allow-Origin: *` and `Cross-Origin-Resource-Policy:
  cross-origin` stay: the shared origin still loads module scripts as CORS
  requests, and Studio's page reads the entry file to diagnose a frame that
  does not start. App files are not secret and are served without
  credentials.
- `frame-ancestors` stays Studio's origin. A nested frame of the app is
  checked by the embedded page's own `frame-ancestors`, as anywhere.
- `worker-src` never includes the app's own files, so an app cannot register
  a service worker on its origin.
- **Desktop:** Electron still keeps an app frame inside its installation
  (`will-frame-navigate`). Frames below an app frame may navigate to http(s)
  URLs; the app document's `frame-src` decides which load, and Chromium checks
  it before the request is sent, also when the embedded page navigates
  itself.

### Declared third-party origins

- The manifest's `sandbox` gains four lists, each empty by default and up to 16
  entries:

  | Field | Directive | For |
  | --- | --- | --- |
  | `frameOrigins` | `frame-src` | pages the app embeds |
  | `connectOrigins` | `connect-src` | `fetch` and XHR to keyless public APIs |
  | `imageOrigins` | `img-src` | images, e.g. map tiles |
  | `mediaOrigins` | `media-src` | audio and video |

- An entry is an origin, `https://host[:port]`, without path, query or
  trailing slash. The host may start with one `*.` label followed by at least
  two labels (`https://*.example.org`); like CSP, the wildcard matches
  subdomains at any depth. `http://` is accepted for loopback hosts only
  (`localhost`, names below `.localhost`, `127.0.0.1`), for development.
  IPv6 literals such as `[::1]` are refused: CSP ignores them as invalid
  sources, so the app's requests would be blocked. Hosted Studio accepts loopback entries only in developer mode
  (`STUDIO_APPS_ALLOW_UNSIGNED=true`) for unsigned packages; desktop always.
  These checks are part of the shared manifest checks of
  `@basyx/studio-app-kit/manifest`, except the developer-mode rule, which
  depends on the deployment.
- Studio refuses an entry that covers Studio's own origin or an apps origin,
  matched as Chromium matches CSP sources: an `http:` entry also covers
  `https:` on port 443 if it names no port or port 80. Studio's API would
  answer such requests as same-site, with the user's cookies. If Studio's URLs change after installation, such entries are left
  out of the policy.
- **Frames with the shared origin:** the package installs, and the consent
  dialog and the *Apps* page say that embedded pages run without cookies or
  storage there and that many stay blank. An app can tell: `self.origin` is
  `'null'` in an opaque frame, so it can offer a link
  (`studio.ui.openExternal`) instead. Refusing the package would make it
  depend on the deployment it is installed in, which signed packages should
  not.
- **Sign-in inside an embed is not supported.** The embedded page is a
  third-party context: browsers block or partition its cookies, forms and
  popups are off, and so are most sign-in flows. Embeds of public pages work;
  pages that need the third party's sign-in may not.
- **Secrets stay on the server.** `connectOrigins` is for APIs that need no
  credentials. The app has none to send: Studio never hands it a token, and
  the browser sends third-party cookies only where it allows them. Services
  with keys, per-deployment endpoints, or calls that must be audited use HTTP
  connections (MVP-7 K1–K9).

### Code from outside the package

- With `connectOrigins`, an app with `webAssembly` can compile bytes it
  fetched, and one with `workers` can start a worker from text it fetched.
  Either runs code that is not in the signed package. WebAssembly and worker
  libraries do this by default when they load their binaries from a CDN.
- A package that declares `connectOrigins` together with `webAssembly` or
  `workers` installs only if it is bundled, or signed by a publisher whose
  trust store entry has `remoteCode: true`:

  ```yaml
  publishers:
    - name: Example GmbH
      keys: [keys/example.pub]
      appIds: [org.example.*]
      remoteCode: true
  ```

  Otherwise it is refused (`app_sandbox_not_granted`), in developer mode too,
  and a managed package is skipped at startup. An installed app whose grant was
  removed is revoked at the next start (`remoteCodeNotGranted`), like an app
  whose key was removed (ADR 0044).
- This closes the path that libraries take on their own. It does not close
  every path: an app can interpret any data it receives, also through a frame
  or an image. The signature and the trust in its publisher remain the
  guarantee, as for everything else an app does with the data it reads.

### Consent

- The consent dialog and the *Apps* page list the four kinds of origins.
  Whenever there is one, they show the data-egress note: the user's browser
  contacts these origins directly, which reveals the user's address and what
  they look at, and the app can send data it read to them, in requests and in
  URLs. The dialog marks the remote-code combination.
- An update's diff (ADR 0044, U6 of the external apps plan) lists added and
  removed origins per kind. Added origins need the confirmation like added
  permissions. Through the API, the administrator's second request is the
  confirmation, as before.

### Full-page modules

- A module contribution may set `layout: "fullPage"`; the default is
  `"standard"`, today's page. A full-page module has no header or breadcrumbs,
  no card and no container padding: the frame fills the page from the
  navigation rail to the window's edges, under Studio's app bar. This applies
  to `global`, `target` and `shell` modules.
- The app bar stays: target switcher, edit switch, drafts, theme and user
  menu. What Studio shows instead of the frame (a target error, a sign-in to
  the target, a missing shell, an app that is not installed) keeps the
  standard layout.
- On a workspace target, saving stays on the target's page; the app bar's
  drafts chip shows the unsaved changes while editing.

### Versions

- The Studio app API becomes **0.1.3**: new optional manifest fields, nothing
  changes for existing apps. In `0.x`, a manifest's caret range (`^0.1.0`)
  excludes a new minor version, so additions stay patch versions, as in
  ADR 0038.
- A manifest that uses `sandbox.*Origins` or `layout` must declare a
  `studioApi` range that excludes app API versions below 0.1.3, e.g.
  `^0.1.3`. The shared manifest checks report it. An older Studio would refuse
  the unknown properties anyway, with a less helpful message.
- `@basyx/studio-sdk`, `@basyx/studio-app-kit` and `@basyx/file-viewer`
  become 0.1.1: additions only, so apps that depend on `^0.1.0` get them.

## Consequences

- Apps can embed public pages, read keyless public APIs, and show images and
  media from declared origins. Each is visible before installation and on
  every update.
- One app cannot reach another's storage, frames or files, also with
  `allow-same-origin`: they have different origins, and an installation's
  files are served only on its own.
- Apps on their own origin get persistent browser storage (`localStorage`,
  IndexedDB, cookies) per installation and browser profile, not per user or
  target. Studio does not clear it on sign-out or uninstall. Apps must not
  keep AAS content there; the SDK's README says so.
- Hosted deployments that want embeds need wildcard DNS and a wildcard
  certificate for the apps domain. Deployments that keep the shared origin
  keep today's isolation, and embedded pages there mostly stay blank.
- Data can leave through declared origins, in requests and in frame and image
  URLs. This was already true for a frame that navigates itself (ADR 0017); it
  is now part of the consent text whenever origins are declared.
- Origins and the full-page layout are fixed per package version. An app
  that needs other origins per deployment uses HTTP connections.
- Embeds that need forms, popups, full screen or the third party's sign-in do
  not work. Each would need its own decision on sandbox flags or permissions
  policy.

## Alternatives considered

- **`frame-src` with the shared opaque origin only:** embedded pages inherit
  the opaque origin and mostly stay blank (see Context).
- **`allow-same-origin` with the shared origin:** every installation in one
  origin; one app could read another's storage and script its frames.
- **A path per installation on one origin with `allow-same-origin`:** the
  same origin for all installations, with the same problem.
- **Proxying embeds through Studio's server:** Studio would serve third-party
  pages on its apps origin, rewrite their URLs, and carry their cookies. It
  breaks most applications and makes Studio responsible for their content.
- **`connect-src` through HTTP connections only:** right for secrets and
  audit, but every deployment would configure a connection for a public API
  that needs neither.
- **Refusing frame origins with the shared origin:** a signed package would
  install in one deployment and be refused in another; a warning and
  `self.origin` let the app degrade instead.
- **Refusing every third-party origin together with WebAssembly or workers:**
  rules out apps such as a 3D viewer that also embeds a public page, while an
  interpreter in JavaScript would get around it anyway.
