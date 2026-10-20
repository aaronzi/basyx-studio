# Work orders

A target module that keeps work orders for the shells of a target in a
work-order service, called through Studio's HTTP connections
([ADR 0047](../../../docs/adr/0047-http-connections-for-apps.md)). The app
never sees the service's URL or a credential.

- [`studio-app.json`](studio-app.json) declares the connection `orders`
  with the permission `studio.connections` and `"studioApi": "^0.1.6"`.
- [`api/work-orders.openapi.json`](api/work-orders.openapi.json) is its
  OpenAPI 3.1 document. `pnpm apps:build` packs the `api` folder next to the
  UI (`studio-app pack --include api`).
- [`ui/src/App.vue`](ui/src/App.vue) calls `studio.connections.call` for
  JSON bodies, an `If-Match` header with the ETag it read, a
  `multipart/form-data` upload and a binary answer (a photo), and shows the
  service's problem details for answers that are not 2xx.
- [`ui/src/dev-studio.ts`](ui/src/dev-studio.ts) answers the same operations
  in memory with `connectionsHandler` of `@basyx/studio-sdk/testing`, so
  `pnpm dev` runs the app without Studio.
- [`service/server.mjs`](service/server.mjs) is the mock service:
  `pnpm service` starts it on port 8080 without authentication;
  `SERVICE_TOKEN` and `OIDC_ISSUER` (with `SERVICE_AUDIENCE`) turn on the
  static token and users' tokens.

[`examples/deployment/http-connections`](../../deployment/http-connections)
runs it with Keycloak, BaSyx and both kinds of connection.
