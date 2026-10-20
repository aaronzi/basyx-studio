# Example apps

Studio apps that prove the app platform (MVP-3, [ADR 0004](../../docs/adr/0004-runtime-installable-apps.md)):

| App | Contributes | Permissions |
| --- | --- | --- |
| `shell-explorer` | Target module with nested routes; shell module | read, navigation |
| `backend-demo` | Target module with a Deno backend | read, backend |
| `fleet-atlas` | Target module with a Deno backend: a zoomable map of the fleet with lenses, questions in plain language and fleet-wide fixes ([README](fleet-atlas/README.md)) | read, write, notifications, backend |
| `starter` | Target module with nested routes, built as an app in its own repository: from the published packages, with a dev server and tests on the test Studio ([README](starter/README.md)) | read, navigation |

The Digital Nameplate example became Studio's bundled `apps/nameplate` in
MVP-4; it shows the nameplate and, in edit mode, changes its properties.

Each app is a Vite + Vue + Vuetify project that uses `@basyx/studio-sdk`.
Build all apps but `starter` and package them as installable `.zip` files:

```bash
pnpm apps:build
```

The packages are written to `examples/apps/dist/`. Install them on the
*Apps* admin page (developer mode: `STUDIO_APPS_ALLOW_UNSIGNED=true`).

`starter` is not part of the workspace. It is built from the packed
`@basyx/*` packages in a folder outside this repository:

```bash
node scripts/check-app-tarballs.mjs --keep
```
