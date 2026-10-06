# Studio test environment

A local, disposable environment to develop and test Studio against every
supported target type and authentication mode. The same environment serves the
dev server, a production build, and the packaged Electron app.

All credentials in this folder are **test-only values**. Never reuse them, and
never configure the `test-cli` password-grant client in a real IdP.

```sh
pnpm testenv:up      # start and wait until healthy (about 30 s)
pnpm testenv:smoke   # verify targets, IdP configuration and access rules
pnpm testenv:down    # stop and discard all data
```

## Services

| Service | URL on the host | Purpose |
| --- | --- | --- |
| `keycloak` | <http://keycloak.localhost:18080> (admin console: `admin` / `admin`) | OIDC provider, realm `basyx-studio` |
| `basyx-open` | <http://localhost:18081> | Unsecured BaSyx Go AAS environment (AAS, submodel and CD repository) |
| `basyx-secured` | <http://localhost:18082> | BaSyx Go AAS environment with OIDC and ABAC |
| `postgres` | `localhost:15432` | Database `studio` (user `studio` / `studio`) for hosted Studio metadata, plus the BaSyx databases |

Images are pinned: BaSyx Go `1.1.0`, Keycloak `26.8.0`, PostgreSQL `18`.

The issuer is `http://keycloak.localhost:18080/realms/basyx-studio`. It must be
byte-identical for the browser, the Studio BFF and BaSyx Go. `*.localhost`
resolves to loopback in browsers, on macOS and on most Linux systems, and the
BaSyx containers map it to the Docker host gateway. If it doesn't resolve on
your machine, add `127.0.0.1 keycloak.localhost` to `/etc/hosts`.

## Targets for Studio

The secured infrastructure is deliberately registered twice, once per
authentication mode. This also exercises multiple independently authenticated
targets within one Studio session.

| Target | Endpoints (all roles) | `securityMode` | Credentials |
| --- | --- | --- | --- |
| Open | `http://localhost:18081` | `unsecured` | none |
| Secured (as user) | `http://localhost:18082` | `delegated_user` | Login of the Studio user; scope `openid basyx-api` |
| Secured (as Studio) | `http://localhost:18082` | `deployment_client_credentials` | client `studio-service`, secret `studio-service-test-secret` |

The AAS environment serves `/shells`, `/submodels` and `/concept-descriptions`
from one base URL. Registry and discovery endpoints are not part of MVP-1.

### Test data

| Target | Content |
| --- | --- |
| Open | `IESEDriveMotorDM3000.aasx` (realistic nameplate, technical data, documentation) |
| Open | `EdgeCasesShell`: every submodel element kind, collections nested 5 levels deep, list of collections, list of lists (`NestedLists[1][0]`), an operation with in/out/inout variables, a hyphenated idShort, an empty value, a 300-element submodel, and a dangling submodel reference that returns 404 |
| Open | 60 `PagingShell…` shells for cursor paging (62 shells in total) |
| Secured | `SecuredPublicShell` (with `Nameplate` and the restricted `Costs` submodel) and `SecuredInternalShell` |

The JSON fixtures are generated and checked with AAS Core 3.1 by
`fixtures/generate-fixtures.mjs` (`pnpm testenv:fixtures`). BaSyx loads them at
startup through `GENERAL_AAS_PRECONFIG_PATHS`.

### Users and expected access on the secured target

| User (password = user name) | Roles | Studio | Secured target |
| --- | --- | --- | --- |
| `studio-admin` | `studio-admin`, `basyx-admin` | admin | full access |
| `alice` | `basyx-reader` | user | reads both shells and all submodels |
| `carol` | `basyx-limited` | user | sees only `SecuredPublicShell`; sees both of its submodel references but gets **403** on `Costs` (partial access) |
| `bob` | none | user | **403** on everything |
| service account `studio-service` | `basyx-reader` | n/a | reads both shells |

BaSyx Go behaviours that Studio must handle (all checked by the smoke test):

- **No token gives 403, not 401.** Studio can't detect "target login required"
  from a 401. It must use its own state: no credential held for this target
  results in the typed `409` target-authentication state.
- **Invalid token or wrong audience gives 401.**
- **List indexes in idShortPaths must be URL-encoded** (`Items%5B1%5D`), and
  this works.
- **BaSyx Go 1.1.0 returns no `ETag`.** Conflict detection for editing (MVP-2)
  needs another mechanism.

## IdP configuration per Studio runtime

| Runtime | How it is started | Studio base URL | OIDC client | Redirect URI |
| --- | --- | --- | --- | --- |
| Dev server | `pnpm dev` | `http://localhost:3000` | `studio-web` (confidential) | `http://localhost:3000/api/studio/v1/auth/callback` |
| Production build | `pnpm build && node .output/server/index.mjs` | `http://localhost:3000` | `studio-web` (confidential) | same |
| Electron dev | `pnpm dev:electron` (uses the dev server's BFF) | `http://localhost:3000` | `studio-web` | same |
| Electron packaged | installed app, local BFF on a random loopback port | `http://127.0.0.1:<random>` | `studio-desktop` (**public**, no secret) | `http://127.0.0.1:<random>/api/studio/v1/auth/callback` |

One callback path serves both Studio login and per-target authorization. The
`studio-web` secret is `studio-web-test-secret`. PKCE (`S256`) is mandatory for
both interactive clients.

A desktop app can't keep a client secret, so the packaged app uses a public
client and an RFC 8252 loopback redirect. Keycloak 26 accepts **any port** for
a registered `http://127.0.0.1/<path>` redirect, but not for `localhost`.

## IdP-agnostic rules for Studio

The test realm intentionally issues tokens shaped like Microsoft Entra ID
tokens, so Keycloak-specific assumptions fail early:

1. **Configure by discovery only.** Studio needs the issuer URL, client ID, the
   client secret reference (confidential clients only) and scopes. It must never
   construct realm or tenant URLs.
2. **Roles come from a configurable claim** (default `roles`, a flat string
   array). The realm doesn't emit Keycloak's `realm_access`.
3. **The Studio login token is not a BaSyx token.** Its audience is the Studio
   client. A target needs its own access token, obtained with target-specific
   scopes:
   - here `basyx-api`;
   - in Entra `api://<basyx-api>/access_as_user`, or `api://<basyx-api>/.default`
     for client credentials.

   Entra issues one resource per access token, so per-target token acquisition
   is required, not optional.
4. **Validate `state`, `nonce` and PKCE in the callback**, and also the `iss`
   authorization-response parameter (RFC 9207), which Keycloak and Entra send.
5. **The desktop loopback host is configurable**:
   - `127.0.0.1` for Keycloak and RFC 8252 providers;
   - `localhost` for Entra, which ignores the port only for `localhost`
     redirect URIs (an `http://127.0.0.1` redirect can only be added through the
     app manifest).
6. **Assume an access-token lifetime of 300 s.** Expect refresh during
   ordinary use; the realm rotates refresh tokens.

## Mapping to Microsoft Entra ID

| Test realm | Entra ID equivalent |
| --- | --- |
| Issuer `…/realms/basyx-studio` | `https://login.microsoftonline.com/<tenant-id>/v2.0` |
| Client scope `basyx-api` (adds audience `basyx-api`) | App registration **BaSyx API**:<br>• *Expose an API* with scope `access_as_user`<br>• manifest `"requestedAccessTokenVersion": 2`, so `aud` is the API's client ID |
| Realm roles `basyx-reader`, `basyx-limited`, `basyx-admin` | App roles on **BaSyx API**, allowed for users/groups and applications |
| Realm role `studio-admin` | App role on the **Studio** app registration (appears in the ID token's `roles`) |
| Client `studio-web` | App registration **Studio**:<br>• platform *Web*, redirect `https://<studio-host>/api/studio/v1/auth/callback`<br>• client secret or certificate<br>• delegated permission `access_as_user` on BaSyx API<br>• use a separate registration for `http://localhost:3000` development |
| Client `studio-desktop` | Public app registration:<br>• platform *Mobile and desktop applications*<br>• redirect `http://localhost/api/studio/v1/auth/callback` (port ignored)<br>• delegated permission `access_as_user` |
| Client `studio-service` (client credentials) | Studio's own registration or a separate one:<br>• *application* permission `basyx-reader` on BaSyx API, with admin consent<br>• token scope `api://<basyx-api>/.default` |
| BaSyx trustlist `audience: basyx-api` | `audience: <basyx-api-client-id>` |

For BaSyx Go with Entra, see
[`examples/BaSyxEntraIDExample`](https://github.com/eclipse-basyx/basyx-go-components/tree/main/examples/BaSyxEntraIDExample).
Delegated tokens carry `scp`; app-only tokens carry only `roles`. Rules that must
accept both should use `{"CLAIMPATH": "/roles"}` with `$contains`, as this
environment's `basyx/secured/access-rules.json` does, and not require scopes.
Prefer app roles over the `groups` claim: Entra replaces groups with an overage
indicator above 200 groups.

Other providers (Ory Hydra, Authentik, Auth0, …) need the same building blocks:
- OIDC discovery;
- authorization code with PKCE;
- confidential and public clients;
- a client-credentials client;
- an audience or resource mechanism for the BaSyx API;
- a flat roles claim (or a BaSyx `claimMappings` entry).

`basyx-go-components/examples/BaSyxOryHydraExample` shows Ory.

## Files

| Path | Content |
| --- | --- |
| `docker-compose.yaml` | All services (compose project `basyx-studio-testenv`) |
| `keycloak/realm-basyx-studio.json` | Realm, clients, scopes, roles and users (imported on start) |
| `basyx/secured/trustlist.json` | Accepted issuer and audience for BaSyx Go |
| `basyx/secured/access-rules.json` | ABAC rules (re-imported on every start) |
| `postgres/init.sql` | Studio and BaSyx databases and users |
| `fixtures/` | Preloaded AAS data and its generator |
| `smoke-test.mjs` | Executable specification of everything above |

## Troubleshooting

- **Port already in use.** Change the host port in `docker-compose.yaml`. If you
  change Keycloak's port, also update `KC_HOSTNAME`, `basyx/secured/trustlist.json`
  and `smoke-test.mjs`, because the issuer contains the port.
- **`basyx-secured` restarts.** It needs Keycloak's discovery document at
  startup; it waits for Keycloak's health check and retries automatically.
- **Changed fixtures, rules or realm** take effect after
  `pnpm testenv:down && pnpm testenv:up`.
