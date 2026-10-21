# HTTP connections example

Studio with Keycloak login, a BaSyx Go AAS environment with two pump shells,
and a mock work-order service. The *Work orders* example app keeps work
orders for the pumps in that service and calls it through Studio's HTTP
connections ([ADR 0047](../../../docs/adr/0047-http-connections-for-apps.md)).

```bash
pnpm apps:build            # writes examples/apps/dist/work-orders.zip
docker compose up -d
```

Open <http://localhost:3000> and sign in as `alice` (password `alice`, an
administrator) or `bob` (`bob`). Pick a target in the navigation rail, then
*Work orders*:

| Target | Connection auth | The service sees |
| --- | --- | --- |
| *Plant (static token)* | `bearer` with `env:WORK_ORDERS_TOKEN` | `static token (token)` |
| *Plant (signed in)* | `delegatedUser`, token exchange at Keycloak | `alice (user)` |

Create an order, mark it done (Studio sends `If-Match` with the ETag the app
read) and attach a photo (a `multipart/form-data` operation). The browser's
network log shows `POST /api/studio/v1/app-calls` only: no token and no
address of the service, which is not even published on the host.

What the example shows:

- The app declares one connection, `orders`, with its OpenAPI document
  ([`api/work-orders.openapi.json`](../../apps/work-orders/api/work-orders.openapi.json))
  and seven operations. The *Apps* page lists them as method and path.
- [`infrastructures.yaml`](infrastructures.yaml) binds the app's connection to
  an `http` connection on each infrastructure (`apps`). An infrastructure
  without the binding refuses the app's calls with `connection_not_bound`.
- [`keycloak/realm-work-orders-example.json`](keycloak/realm-work-orders-example.json)
  enables token exchange for Studio's client (`standard.token.exchange.enabled`)
  and has a client scope `work-orders` with an audience mapper. The
  connection asks for that scope, so the exchanged token is issued to
  `work-orders`. The service refuses the user's own token, which is issued to
  Studio.
- The service is [`examples/apps/work-orders/service/server.mjs`](../../apps/work-orders/service/server.mjs),
  Node without dependencies. It checks RS256 tokens against Keycloak's keys
  and the audience, or the static token.

The Studio image needs app API 0.1.6 or later; until a release has it, build
one and set `STUDIO_IMAGE`:

```bash
docker build -t basyx-studio:dev ../../..
STUDIO_IMAGE=basyx-studio:dev docker compose up -d
```

`test/e2e/web/connections.spec.ts` checks the same flows against the test
environment.
