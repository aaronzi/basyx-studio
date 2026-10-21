# @basyx/studio-app-kit

Build [BaSyx Studio](../../README.md) apps with Vue and Vuetify that look like
Studio, and package them with Studio's own checks
([ADR 0043](../../docs/adr/0043-published-sdk-and-app-kit.md)). Studio's
bundled apps use the kit as an app from another repository does.

```bash
pnpm add @basyx/studio-sdk @basyx/studio-app-kit vue vuetify
pnpm add -D vite @vitejs/plugin-vue sass
```

[`examples/apps/starter`](../../examples/apps/starter) is a complete app in
its own repository.

## Mounting an app

```ts
import { mountApp } from '@basyx/studio-app-kit'
import { VApp } from 'vuetify/components/VApp'
import { VList, VListItem } from 'vuetify/components/VList'
import App from './App.vue'

await mountApp(App, { VApp, VList, VListItem })
```

`mountApp` connects to Studio, creates Vuetify with Studio's defaults,
aliases (`<v-btn-primary>`, `<v-btn-toggle-icon>` for icon-only choices in a
`<v-btn-toggle>`, `<v-card-fullscreen>` for a view that fills the window,
`<v-view-card>`), the `v-tooltip` directive and icons, follows Studio's
theme, mounts `App` into `#app` with the client as its `client` prop, and
sizes the frame to the content. Pass `{ client }` to run on another client,
e.g. the test Studio of `@basyx/studio-sdk/testing` in a dev server.

| Entry | What |
| --- | --- |
| `@basyx/studio-app-kit` | `mountApp`, `loadSubmodel`, and the AAS helpers below |
| `@basyx/studio-app-kit/aas` | Reading AAS JSON without Vue: `childrenOf`, `child`, `langText`, `textOf`, `humanize` |
| `@basyx/studio-app-kit/i18n` | `provideI18n(client, en, translations)` and `useI18n()`: texts that follow Studio's locale, English as fallback |
| `@basyx/studio-app-kit/defaults` | The Vuetify defaults of `mountApp`, e.g. for lint rules |
| `@basyx/studio-app-kit/vuetify-defaults` | The defaults Studio and its apps share (fields, button groups) |
| `@basyx/studio-app-kit/settings.scss` | Studio's Vuetify Sass settings |
| `@basyx/studio-app-kit/vite` | The `studioApp()` Vite preset |
| `@basyx/studio-app-kit/manifest`, `/package`, `/signature` | The checks, packing and signatures of `studio-app`, for Node; `manifest` also indexes and compiles the OpenAPI documents of `connections` (`checkConnectionApis`) |

Views render flat inside the card Studio draws; build the UI from Vuetify
components and utility classes, as Studio does.

## Vite

```ts
import { studioApp } from '@basyx/studio-app-kit/vite'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'

export default defineConfig({ plugins: [vue(), studioApp()] })
```

The preset builds `ui/index.html` to `dist/ui/` with relative URLs, as
Studio serves an app under `/app/<installation>/ui/`, and compiles Vuetify's
Sass with Studio's settings, in the dev server too. Workers are ES modules,
and occt-import-js (STEP in `@basyx/model-viewer`) is built without
`new Function`, which app frames forbid. `studioApp({ root: 'web' })` uses
another folder.

## The `studio-app` command

```bash
studio-app pack [project] [--dist dist] [--include backend] [--include api] [--out <file or folder>]
studio-app sign <package.zip> --key signing.pem [--out <file>]
studio-app verify <package.zip> [--key signing.pub] [--signature <file>]
```

- `pack` packages `studio-app.json`, the files below `dist/` at their paths
  there, and each `--include` folder at its own path, as
  `<id>-<version>.zip`. The same files always give the same bytes.
- `pack` and `verify` run the checks of Studio's upload (ADR 0016): the
  manifest schema, unique contribution IDs and routes, entries that exist,
  the backend permission, the format of `sandbox` origins, an app API range
  that includes every field the manifest uses (`^0.1.3` for origins and
  `layout`, `^0.1.6` for `connections`), the app API range against the
  installed `@basyx/studio-sdk`, file types and archive limits (20 MiB,
  50 MiB expanded, 2,000 entries).
- For `connections` ([ADR 0047](../../docs/adr/0047-http-connections-for-apps.md)),
  they also check each OpenAPI document as Studio's upload does: JSON,
  OpenAPI 3.0 or 3.1, at most 4 MiB, only local `$ref`s, every listed
  `operationId` exactly once, parameters Studio can send, no body with `GET`
  or `HEAD`, and schemas that compile. A finding names the document and a
  JSON pointer into it, e.g. `api/orders.json#/paths/~1orders/get/parameters/2`.
  Keep the document outside `dist/` and pack it with `--include api`, or put
  it in Vite's `public` folder; `api` names its package path. `pack` and
  `verify` print a note that the connections need an administrator's
  binding.
  Studio's server imports the same code. The runtime, origins that cover the
  deployment's own, and the trust store's `remoteCode` grant for
  `connectOrigins` with `webAssembly` or `workers` are checked at install
  ([ADR 0045](../../docs/adr/0045-app-origins-embeds-and-full-page-modules.md));
  `pack` and `verify` print a note when a package needs that grant.
- `sign` writes `<package.zip>.sig`: ECDSA P-256 with SHA-256 over the exact
  package bytes, DER-encoded, in base64. That is what
  `cosign sign-blob --key --output-signature` writes, so
  `cosign verify-blob --key signing.pub` checks it. `verify` also reads the
  Sigstore bundle that cosign 3 writes by default, as Studio does
  ([ADR 0044](../../docs/adr/0044-app-package-signatures-trust-store-and-updates.md)).
  The key is PEM (PKCS#8 or SEC1); an encrypted PKCS#8 key takes its
  passphrase from `STUDIO_APP_KEY_PASSPHRASE`. Cosign's own encrypted key
  files are not read; sign with cosign if your key is one.
- `verify --key` also checks the signature and prints the key's
  fingerprint (`sha256:` of its public key).

A key pair:

```bash
openssl ecparam -name prime256v1 -genkey -noout | openssl pkcs8 -topk8 -nocrypt -out signing.pem
openssl ec -in signing.pem -pubout -out signing.pub
```

Keep `signing.pem` in your CI's secrets; give `signing.pub` to the operators
of the Studio deployments that install your app.

Versions follow `@basyx/studio-sdk` ([version table](../studio-sdk/README.md#versions)).
