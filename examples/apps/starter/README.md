# Starter: a Studio app in its own repository

A Studio app as a team outside Studio's repository builds it
([ADR 0043](../../../docs/adr/0043-published-sdk-and-app-kit.md)): from the
published packages only, with a dev server and unit tests that need no
Studio. It lists the shells of the active target, a page per shell with its
submodels, and the 3D models they hold.

| Package | Used for |
| --- | --- |
| [`@basyx/studio-sdk`](../../../packages/studio-sdk/README.md) | The client (`connect`), and the test Studio (`@basyx/studio-sdk/testing`) |
| [`@basyx/studio-app-kit`](../../../packages/studio-app-kit/README.md) | `mountApp` with Studio's look, AAS and i18n helpers, the `studioApp()` Vite preset, `studio-app` |
| [`@basyx/file-viewer`](../../../packages/file-viewer/README.md) | Which File elements hold 3D models, and the icon of each, as Studio's file viewer shows it |

Copy this folder into a new repository; it is not part of Studio's pnpm
workspace.

```bash
pnpm install
pnpm dev          # the app on the test Studio of ui/src/dev.ts; ?locale=de&dark
pnpm test         # unit tests against the same test Studio
pnpm typecheck
pnpm build        # ui/ → dist/ui/
pnpm package      # studio-app pack → org.example.studio.starter-0.1.0.zip
```

Sign the package for a Studio that trusts your key, with the private key
in a CI secret:

```bash
openssl ecparam -name prime256v1 -genkey -noout | openssl pkcs8 -topk8 -nocrypt -out signing.pem
openssl ec -in signing.pem -pubout -out signing.pub
pnpm exec studio-app sign org.example.studio.starter-0.1.0.zip --key signing.pem
pnpm exec studio-app verify org.example.studio.starter-0.1.0.zip --key signing.pub
```

`cosign sign-blob --key` writes the same `.sig` format. Until Studio checks
signatures (phase C of the [external apps plan](../../../docs/development/external-apps-plan.md)),
install the package on Studio's *Apps* page in developer mode
(`STUDIO_APPS_ALLOW_UNSIGNED=true`).

## How it is put together

- `ui/src/main.ts` mounts the app with `mountApp`. Inside Studio's frame it
  connects to Studio; in `pnpm dev`, outside a frame, it uses
  `createDevStudio()` from `ui/src/dev.ts`, an in-memory Studio with
  fixtures, which production builds leave out.
- The test Studio is built from `studio-app.json` as imported
  (`createTestStudio({ manifest })`): it answers Studio's UI methods
  (`navigate` moves `context.subPath`, so the shell page works as in
  Studio) and refuses calls the manifest's permissions do not cover, as
  Studio does.
- `vite.config.ts` uses the kit's `studioApp()` preset: `ui/` is built to
  `dist/ui/` with relative URLs, and Vuetify gets Studio's Sass settings,
  also in the dev server.
- `pnpm-workspace.yaml` holds the repository's pnpm settings: a day's
  release age and the reviewed build scripts.

In Studio's repository, CI builds this example from the packed packages
(`node scripts/check-app-tarballs.mjs`), so the packages are checked as an
outside app uses them.
