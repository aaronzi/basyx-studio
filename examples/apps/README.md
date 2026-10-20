# Example apps

Studio apps that prove the app platform (MVP-3, [ADR 0004](../../docs/adr/0004-runtime-installable-apps.md)):

| App | Contributes | Permissions |
| --- | --- | --- |
| `shell-explorer` | Target module with nested routes; shell module | read, navigation |
| `backend-demo` | Target module with a Deno backend | read, backend |
| `fleet-atlas` | Target module with a Deno backend: a zoomable map of the fleet with lenses, questions in plain language and fleet-wide fixes ([README](fleet-atlas/README.md)) | read, write, notifications, backend |
| `public-embeds` | Full-page global module (`layout: fullPage`) that embeds a public map and reads the weather from a keyless public API (`sandbox.frameOrigins`, `connectOrigins`, [ADR 0045](../../docs/adr/0045-app-origins-embeds-and-full-page-modules.md)). The map needs one apps origin per installation (`STUDIO_APPS_URL=http://{installation}.apps.localhost:3000`) to work reliably | navigation |
| `work-orders` | Target module that keeps work orders for shells in a mock service, called through an HTTP connection (`connections`, [ADR 0047](../../docs/adr/0047-http-connections-for-apps.md)); the service and a Compose example are in [README](work-orders/README.md) | read, notifications, connections |
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
