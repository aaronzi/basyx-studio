# 0047: HTTP connections for apps, declared operations and token exchange

- Status: Proposed
- Date: 2026-10-20
- Deciders: BaSyx Studio maintainers
- Builds on: the connections core of
  [ADR 0040](0040-connections-on-infrastructures.md), which already has the
  auth schemes, the credential broker with token exchange, the stored format
  and *Test connection*
- Takes over: K1–K9 and K5a of the [MVP-7 plan](../development/mvp-7-plan.md)
  ("Connections for apps"), for phase E of the
  [external apps plan](../development/external-apps-plan.md)
- Relates to: `sandbox.connectOrigins` of
  [ADR 0045](0045-app-origins-embeds-and-full-page-modules.md)
- Requirements: APP-008, CON-001 to CON-003, CON-005 to CON-007, SEC-005,
  OPS-006

## Context

Apps reach AAS content through capabilities, and the time series view reads
databases through a purpose-specific capability (ADR 0040). An app that
needs its own service, such as an import service, a work-order API or a
third-party REST API with a key, has no way to call it:

- the frame's Content Security Policy allows the app's own files, plus the
  `connectOrigins` of ADR 0045, which are for keyless public APIs only;
- backend apps have no network access;
- a key in the app's bundle would reach every browser, as the database token
  of the forked web UI that the external apps plan's pilot replaces did.

ADR 0040 decided that only the Studio Service uses a connection's credential,
that the URL never comes from the app or from content, and that there is no
generic proxy. It left the `http` type, the binding to apps and the
capability method to MVP-7. The pilot needs them now, for a third-party REST
API and for services that should see the signed-in user.

## Decision

### Connections of type `http`

An infrastructure's `connections` (ADR 0040) gain the type `http`: a generic
HTTP service whose usable surface is the set of operations that bound apps
declare. There is no free path, method or URL (CON-002).

```yaml
connections:
  - key: weather                       # unique within the infrastructure
    type: http
    url: https://api.weather.example/v1   # replaces the document's servers
    auth: { scheme: header, name: X-Api-Key, value: { ref: env:WEATHER_KEY } }
    timeoutSeconds: 30                 # default 30, up to 120
    apps:                              # who may call it, and as what
      - { app: org.example.weather-board, connection: forecast }
```

- `auth` accepts every scheme of ADR 0040: `none`, `token`, `bearer`,
  `header`, `basic`, `oauth2ClientCredentials` and `delegatedUser`. The
  OpenAPI document's `security` is ignored: the administrator's scheme is the
  one Studio uses.
- `apps` binds app connections to this connection (K3): `app` is an app ID,
  `connection` the `id` of a connection in that app's manifest. Up to 50
  entries, each pair at most once per infrastructure. The binding names the
  app ID, not an installation, so it survives an in-place update and can be
  written before the app is installed. It sits next to the credential: one
  place says where a credential may be used (CON-003).
- `aliases` stay empty for `http`: no AAS content names these services, so
  there is nothing to match.
- `settings` is an empty object for now; the field is kept for the type
  union.
- `http` serves no content purpose, so `studio.timeseries.read` never picks
  it.
- The stored format (migration 0007), declared YAML, export and import are
  unchanged: `apps` is one more field of the stored connection summary.

### Connections in the manifest

```json
"permissions": ["studio.connections"],
"connections": [{
  "id": "forecast",
  "title": { "en": "Weather forecasts" },
  "api": "api/weather.openapi.json",
  "operations": ["getForecast", "listStations"]
}]
```

- `connections` is a top-level manifest field (K2), with up to 16 entries.
  `id` follows the connection key pattern (`[a-z0-9][a-z0-9-]{0,62}`).
  `operations` lists 1 to 200 `operationId`s of the document that the app
  calls. Operations the document has but the app does not list stay
  unreachable.
- `api` is an OpenAPI 3.0 or 3.1 document **in JSON** inside the package, at
  most 4 MiB. JSON, because app packages may not contain YAML files and
  Studio then parses the document without another parser; `studio-app pack`
  takes it like any other file of the build output.
- Calling needs the permission `studio.connections`. It is not reserved: the
  administrator's binding is the gate (K9), and the consent dialog shows the
  operations.
- The manifest declares Studio app API `^0.1.6` or higher to use
  `connections`; `studio-app pack` reports a lower range, as for ADR 0045's
  fields.

`studio-app pack`, `studio-app verify` and Studio's upload share the checks
(`@basyx/studio-app-kit/manifest`):

- the document exists, is JSON, says `openapi: 3.0.x` or `3.1.x`, and uses
  the default JSON Schema dialect;
- each listed `operationId` occurs exactly once;
- every `$ref` is local (`#/…`) and resolves; documents that refer to other
  files are bundled first;
- parameters are `path`, `query` or `header` parameters with primitive values
  or arrays of them, in the default styles (`simple` for path and header,
  `form` for query); `cookie` parameters, `deepObject` and objects are
  findings. Header parameters may not be headers Studio sets
  (`Authorization`, `Cookie`, `Host`, `Content-Type`, `Accept`, …);
- every `{name}` of the path template is a path parameter;
- every schema of the declared operations compiles;
- `studio.connections` and `connections` come together, like `studio.backend`
  and `backend`.

The install and update dialog lists each connection with its operations as
method and path (K2). An update that adds a connection or an operation, or
changes an operation's method or path, marks it *New*, and confirming the
update covers it (ADR 0044 U6). Operations an update removes become
unreachable.

### Calling an operation

```ts
const forecast = await studio.connections.call({
  connection: 'forecast',
  operation: 'getForecast',
  path: { station: 'berlin' },
  query: { days: 3 },
})
// { status: 200, contentType: 'application/json', etag: '"7"', location: null, body: { … } }
```

`studio.connections.call({ connection, operation, path?, query?, headers?,
contentType?, body? })` returns `{ status, contentType, etag, location, body }`
(K4). Compared with the plan, it adds `headers` for the operation's declared
header parameters, so an app can send `If-Match` with the `etag` it read, and
`contentType` to pick one of several request media types (default: the
first the operation declares).

Studio refuses, in this order, and audits each refusal (K8):

1. `app_permission_not_declared` without `studio.connections`;
2. `connection_operation_not_declared` for a connection the manifest does not
   declare, or an operation it does not list;
3. `connection_not_bound` when the frame has no target, the target is a
   desktop workspace, or no `http` connection of the target's infrastructure
   binds this app ID and connection;
4. `target_auth_required` and the like when the user cannot open the
   infrastructure: for every scheme, also the service identities, Studio
   first checks the user's access to the infrastructure (SEC-005);
5. `invalid_request` with violations when a parameter or the body does not
   match the operation;
6. `connection_busy` (429, retryable) with four calls of this session to this
   connection in flight (K7).

Then Studio builds the request:

- The URL is the connection's `url` followed by the operation's path
  template. The document's `servers` are ignored. Path values are encoded as
  one segment each; `.` and `..` are refused, so a value cannot leave the
  template. Only declared query and header parameters are sent.
- The method is the operation's. `Content-Type` comes from the chosen media
  type, `Accept` from the media types of the operation's responses.
- Studio adds the scheme's credentials, sends the request through the guarded
  fetch (the connection's origin only, its timeout, 20 MiB answers at most)
  and never follows a redirect.

The answer:

- Every status is a result, not an error, so the app can show a service's
  problem details. Only `3xx` other than `304` are refused
  (`connection_request_refused`): Studio follows no redirect and hands out
  no address to follow.
- `401` and `403` also drop the cached token of the connection, so the next
  call gets a new one; the answer is still returned.
- `location` is the answer's `Location` relative to the connection's URL,
  like the operations' paths (`/orders/7`), so the service's address stays
  with Studio. A `Location` elsewhere becomes `null`.
- `body` is a JSON value for JSON media types (`application/json`, `+json`),
  a string for text (`text/*`, XML, YAML), a `Uint8Array` for anything else,
  and `null` when empty. JSON that does not parse is returned as text.
- Transport failures stay problems: `connection_unavailable` (timeout,
  unreachable, answer too large), `connection_credentials_unavailable`, and
  the broker's token problems. The app gets them without the host names and
  addresses the network layer reports; the audit keeps the original message
  (`reason`).

### Bodies

- JSON media types take a JSON value, text media types a string,
  `application/x-www-form-urlencoded` takes `{ fields }`, `multipart/form-data`
  takes `{ fields, files }` with
  `files: { name: { fileName, contentType?, bytes } }`, and every other media
  type a `Uint8Array` (K6). Studio builds the form and multipart bodies.
- Up to 8 MiB per request body. Larger uploads are chunked by the app through
  its service's own chunk operations; streaming is out of scope.
- Studio validates path, query and header values and JSON bodies against the
  operation's schemas with Ajv. OpenAPI 3.1 schemas are JSON Schema 2020-12;
  3.0 schemas are converted first (`nullable`, boolean
  `exclusiveMinimum`/`exclusiveMaximum`). A property marked `readOnly`,
  directly or through a reference, is not required in a request even where
  `required` lists it, as OpenAPI defines. Parameter values may be given as
  strings and are coerced to the schema's type; array parameters take arrays,
  sent comma-separated in paths and headers and repeated or comma-separated
  in queries as the operation's `explode` says. Form and multipart fields are
  checked against the body schema's properties, `required` and
  `additionalProperties: false`. Text and bytes are not inspected. Responses
  are not validated: they are the service's.
- In the HTTP binding (`POST /app-calls`), bytes travel as base64: a request
  body as a string with `"encoding": "base64"` next to it, a multipart file
  as `{ fileName, contentType, base64 }`, and a binary answer as a string
  with `"encoding": "base64"`. Studio's page and the backend harness convert
  them, so apps and backends see `Uint8Array`.

### Identity of the user (K5, K5a)

As ADR 0040 decided and the credential broker implements: `delegatedUser`
needs an infrastructure whose users sign in. Studio exchanges the user's
token for this infrastructure at the issuer's token endpoint, as the
infrastructure's OIDC client, for one with the connection's `audience` and
`scopes` (RFC 8693), and caches it per session and connection until it
expires. *Test connection* performs the exchange, so a missing grant at the
IdP shows there. With `forwardUserToken: true`, Studio forwards the user's
token unchanged, only if its `aud` contains the `audience`; the dialog and the
deployment guide warn that the service could replay it against the AAS
server. The audit records which of the two happened.

For `http`, *Test connection* runs the token check and then sends `GET` to
the connection's `url` without following redirects: any answer other than
`401`, `403` or `5xx` passes.

### Audit (K8)

`connection.call` records the user, the app installation and ID, the
infrastructure, the infrastructure connection, the app connection, the
operation and method, the status, the duration, the caller (frame or backend)
and the delegation, with the identity the service saw as
`downstreamIdentity`. Never parameters, headers or bodies (CON-006,
OPS-006). Answered calls are `success` whatever their status; refusals and
transport failures are `failure` with the problem code.

### Who may call (K9)

- Installed apps, signed or unsigned, and bundled apps: the binding is the
  gate, not the trust level.
- Backend apps call `studio.connections.call` through `studio.call`, with the
  target and user of their capability token, so they reach their services
  without network access of their own.
- Desktop infrastructures have connections too; desktop workspaces do not.
- Global modules outside a target cannot call: a connection belongs to an
  infrastructure. Single-app mode (ADR 0046) pins a target, which covers it.

### Connections and `connectOrigins`

| | `sandbox.connectOrigins` (ADR 0045) | HTTP connections (this ADR) |
| --- | --- | --- |
| Who sends the request | The user's browser | The Studio Service |
| Credentials | None; the app must not ship any | Any scheme, kept by Studio |
| Who names the URL | The app's publisher, in the manifest | The administrator, per infrastructure |
| What may be called | Anything at the origin | The declared operations |
| Audit | None | Every call |
| Who the service sees | The user's address | Studio, or the user's identity by `delegatedUser` |
| Private networks | Only what the browser reaches | What the Studio Service may reach (`allowPrivateNetwork`) |

A keyless public API may use either. `connectOrigins` fits public data with a
fixed origin that every user's browser may contact. A connection with
`scheme: none` fits when the deployment chooses the endpoint, needs the calls
audited, or wants the browser not to contact third parties. Anything with a
secret, a per-deployment URL or the user's identity is a connection.

## Consequences

- An app calls its services without a token or URL in the browser. The
  network log shows `POST /app-calls` with the operation's parameters and
  nothing else.
- Administrators see what an app may call twice: at install, and when they
  bind it. An app cannot reach an operation its publisher did not declare, nor
  a connection the administrator did not bind.
- Apps describe their services with OpenAPI, which most services publish
  already. Documents with external references are bundled before packing.
- Studio parses and validates each document once per package digest and
  keeps the compiled validators in memory.
- Each call writes an audit row, as `studio.timeseries.read` does.
- Streaming, server-sent events and uploads over 8 MiB are not possible;
  apps chunk them.

## Alternatives considered

- **`studio.http.fetch` with declared origins (APP-008 as first written):**
  the app would choose path and method, so a credential would go to any
  endpoint of the service. Declared operations bound by the administrator
  keep the surface reviewable.
- **Operations in the manifest instead of OpenAPI:** a second description
  language for what services already describe; validation of bodies would
  need schemas anyway.
- **Binding on the installation:** it would be lost with a reinstall and
  could not be declared in YAML before the app is installed.
- **YAML API documents:** packages would have to admit YAML files, and the
  manifest checks of the app kit would need a YAML parser in the browser and
  in Node.
- **Following redirects within the origin:** a service could still redirect
  the credential to another path; refusing them is simpler and matches the
  guarded fetch.
- **Errors for non-2xx answers:** the app could not show a service's problem
  details or handle `409` and `412` itself.
