# MVP-1 plan: live AAS access through the Studio BFF

- Status: Planned (phase 0 partially done)
- Date: 2026-10-06
- Scope decision gate: the first representative vertical slice

## Goal

Prove the Studio architecture on one path that delivers real value, before
porting features from the BaSyx AAS Web UI:

> sign in → choose target → authorize target if needed → list shells → open
> shell → list submodels → browse element tree → see element JSON

Every call goes UI → `/api/studio/v1` → Studio BFF → `basyx-typescript-sdk` →
BaSyx. The renderer never sees an infrastructure URL, token, or credential.

Porting the old UI's Vue components starts in MVP-2, on top of the contract this
slice establishes. Compiling copied components before a target contract exists
proves nothing.

## Scope decisions

| Topic | MVP-1 decision |
| --- | --- |
| Data operations | Read-only. Editing (save, reload, conflicts) is MVP-2. |
| Shell source | AAS repository with cursor paging. Registry and discovery resolution come later. |
| Downstream authentication | `unsecured`, `deployment_client_credentials`, and `delegated_user` (per-target OIDC authorization code with PKCE) |
| Studio login | OIDC authorization code with PKCE for hosted deployments; the local OS user on desktop |
| Infrastructure configuration | Stored in the database and managed through the admin API (`/infrastructures`), plus a minimal admin page |
| Persistence | One PostgreSQL schema: a PostgreSQL server when hosted, embedded PGlite on desktop ([ADR 0011](../adr/0011-single-postgresql-dialect-with-pglite.md)) |
| Runtimes | Hosted web (dev and production build) and packaged Electron |
| Visualization | Shell list, submodel tree, and a JSON panel; no specialized viewers |

## Definition of done

Run against the [test environment](../../test-setup/README.md), in both hosted
web and packaged Electron:

1. **studio-admin** signs in and registers three targets through the admin API:
   - **Open:** `unsecured`.
   - **Secured (as user):** `delegated_user`.
   - **Secured (as Studio):** `deployment_client_credentials`.
2. **alice** signs in, sees that the "Secured (as user)" target requires
   authorization, authorizes it, and browses both secured shells.
   Meanwhile:
   - the "Secured (as Studio)" target works without a per-user authorization;
   - the open target works without any credential.
3. **carol** sees only the public shell. Opening the restricted `Costs` submodel
   shows a typed *forbidden* state while the rest of the tree stays usable.
4. **bob** gets a typed *forbidden* state for the secured target; the open target
   still works.
5. **Browsing the open target works for the hard cases:**
   - all 62 shells page correctly;
   - `EdgeCasesShell` shows nested collections, lists of lists, operation
     variables, and the large submodel;
   - the dangling submodel reference appears as *not found*.
6. **Target switching is clean.** Switching while requests are in flight never
   shows data from the previous target.
7. **Expiry and outages are handled.** An expired access token is refreshed
   transparently. A revoked session or a stopped BaSyx container results in a
   typed state and a clear message.
8. **No secrets reach the client.** No response, log line, or renderer storage
   contains a token, client secret, or downstream URL.

## Workstreams

- **A, platform:** persistence, sessions, admin API, credential strategies.
- **B, AAS access:** SDK adapter, read API, UI.

Workstream B starts immediately against a temporary in-memory target
registry, configured from environment variables to point at the test
environment's open target. It switches to the database-backed registry when
workstream A lands. The temporary registry is deleted at that point, not kept
as a second configuration path.

## Phases

### Phase 0: groundwork and qualification

Done:

- [x] Test environment (`test-setup/`):
  - PostgreSQL;
  - Keycloak realm with Entra-shaped tokens;
  - unsecured and secured BaSyx Go 1.1.0;
  - AAS Core-verified fixtures;
  - 31-check smoke test.
- [x] Interactive browser login and code exchange (`studio-web`, PKCE, `iss`
  response parameter) verified against the test IdP.
- [x] idShortPath list indexes work URL-encoded (`Items%5B1%5D`,
  `NestedLists%5B1%5D%5B0%5D`).
- [x] Keycloak accepts RFC 8252 loopback redirects on any port for the
  desktop client.

Open:

- [ ] Add Vitest and a `pnpm test` script.
- [ ] Check that aas-core 1.0.1 works inside the Nitro server build and the
  Electron build. Its ESM build fails in plain Node because of extensionless
  imports; the CommonJS build works.
- [ ] Check `basyx-typescript-sdk` 2.2.5 in Nitro:
  - per-request `Configuration` with a custom `fetchApi`;
  - SDK instances come from the SDK's bundled aas-core copy, so use
    `modelType()` or the `is*` helpers, never `instanceof`.
- [ ] Check `openid-client` in Nitro against the test IdP.
- [ ] Run the PGlite qualification gate from ADR 0011:
  - packaging in Electron;
  - crash safety;
  - footprint;
  - one migration chain on both drivers;
  - engine upgrade through dump/restore.

  This also decides Drizzle adoption (setup guide, section 10).

### Phase 1: persistence (A)

- [ ] **Drizzle `pgTable` schema:**
  - `infrastructures` and their endpoints, with a row version for `If-Match`;
  - `studio_sessions`;
  - `oidc_transactions` (state, nonce, PKCE verifier, short TTL);
  - `target_credentials` (encrypted token material per session and target);
  - `audit_events`.
- [ ] One migration chain. Driver selection by deployment mode:
  `node-postgres` when hosted, PGlite on desktop and in tests.
- [ ] `SecretCipher` (AES-GCM) for token material.
  - **Hosted:** the key comes from the deployment secret store.
  - **Desktop:** Electron main keeps the key in `safeStorage` and passes it to
    the local Studio Service at launch, like the launch secret.
- [ ] Electron single-instance lock, so only one process opens the PGlite
  directory.

### Phase 2: Studio session and login (A)

- [ ] `GET /context`, `GET /session`, `POST /auth/login`, `GET /auth/callback`,
  `POST /auth/logout`.
- [ ] **Cookie and CSRF:** an opaque HttpOnly session cookie (`SameSite=Lax`
  for the callback), rotated at login. `X-CSRF-Token` plus an Origin check on
  every mutation.
- [ ] **Role mapping:** claim path configurable, default `roles`; the
  `studio-admin` role gates the admin API.
- [ ] **Callback validation:** `state`, `nonce`, PKCE, and the RFC 9207 `iss`
  parameter.
- [ ] **Desktop:** a local-user session authenticated by the existing launch
  secret, with no Studio IdP.

### Phase 3: infrastructure administration (A)

- [ ] `GET/POST /infrastructures`, `GET/PATCH/DELETE /infrastructures/{id}`
  (`PATCH` with `If-Match`), and `POST /infrastructures/{id}/probe`.
- [ ] Endpoint validation per deployment mode:
  - scheme and port policy;
  - DNS resolution, with private and loopback addresses denied by default when
    hosted and allowed for Docker targets on desktop;
  - no embedded credentials in URLs.
- [ ] The probe calls BaSyx `/description` and `/health`; `/description` is
  public even on the secured test target.
- [ ] Secrets are accepted only as secret references, never stored as values.
- [ ] A minimal Vuetify admin page.

### Phase 4: credential strategies (A + B)

- [ ] **`unsecured`.**
- [ ] **`deployment_client_credentials`:** token cached per target and
  refreshed before expiry. Studio authorization and an audit record covering
  both identities still apply to every request.
- [ ] **`delegated_user`:**
  - `POST/DELETE /targets/{id}/authorization`;
  - tokens stored per (session, target) and refreshed on expiry;
  - target-specific scopes from the target configuration (`openid basyx-api`
    in the test realm, `api://<basyx-api>/access_as_user` in Entra);
  - the Studio login token is never reused implicitly.
- [ ] **Login-required detection:** "target authentication required" (`409`)
  comes from Studio's own state (no usable credential for this target), not
  from downstream status codes. BaSyx Go answers 403 when no token is sent.
- [ ] **Desktop login:**
  - the system browser opens the authorization URL;
  - the loopback callback on the local BFF is exempt from the launch-secret
    check and is validated against server-side `state`;
  - the renderer learns the result by polling;
  - the loopback host is configurable: `127.0.0.1` for RFC 8252 IdPs,
    `localhost` for Entra.

### Phase 5: read API (B)

- [ ] **Target routing:**
  - an SDK `Configuration` factory per target;
  - a guarded `fetchApi` that enforces the origin allowlist, `redirect:
    'manual'`, timeouts, and response-size limits;
  - credential injection by the strategy;
  - W3C trace context and request IDs propagated downstream.
- [ ] **`LiveAasTarget` adapter** over `AasRepositoryClient` and
  `SubmodelRepositoryClient`. It doesn't use `AasService.getAasList`, which
  drops the cursor, issues N+1 requests, and strips path prefixes.
- [ ] **Routes:**
  - `GET /targets`, `GET /targets/{id}`, `PUT /targets/{id}/activation`;
  - `GET /targets/{id}/shells` (cursor paging) and
    `GET /targets/{id}/shells/{key}`;
  - submodel references of a shell;
  - `GET /targets/{id}/submodels/{key}`;
  - `GET /targets/{id}/submodels/{key}/elements?parentElementKey=` returns tree
    nodes: `key`, `idShort`, `modelType`, `semanticId`, `hasChildren`;
  - `GET /targets/{id}/submodels/{key}/elements/{elementKey}` returns the full
    element JSON.
- [ ] **Resource keys** are base64url-encoded identifiers or idShortPaths,
  matching the OpenAPI draft's `OpaqueId` pattern.
- [ ] **Errors:** SDK `ApiResult` responses map to `application/problem+json`
  with stable codes:
  - `target_auth_required`;
  - `forbidden`;
  - `not_found`;
  - `target_unreachable`;
  - `invalid_target_response`.

### Phase 6: minimal UI (B)

- [ ] Sign-in and sign-out, and a target picker showing authorization state with
  an *Authorize* action.
- [ ] `targetId` is part of the route. There is no global infrastructure store,
  and every Pinia Colada key starts with the target ID.
- [ ] Shell list with paging, submodel list, lazy element tree (`v-treeview`),
  and a read-only JSON panel.
- [ ] Typed empty, forbidden, not-found, and target-unreachable states.

### Phase 7: hard cases and verification

- [ ] Every scenario in the definition of done, automated where practical:
  - Vitest for BFF modules;
  - integration tests against the test environment;
  - one Playwright smoke test for hosted.
- [ ] Hosted production build (`node .output/server/index.mjs`) and packaged
  Electron on at least one OS.
- [ ] Decision-gate review with the maintainers.

## ADRs to write during MVP-1

- Session, CSRF, and token-encryption model (phases 1–2).
- Desktop OIDC loopback flow and launch-secret exemption (phase 4).
- Drizzle adoption, after the phase-0 qualification.

## Known risks

| Risk | Mitigation |
| --- | --- |
| PGlite fails qualification | `embedded-postgres` fallback with the same schema (ADR 0011) |
| BaSyx Go 1.1.0 sends no `ETag` | Not needed in read-only MVP-1. MVP-2 needs a fallback, such as comparing against a fresh read, or ETag support upstream. |
| The SDK bundles its own aas-core copy | Use type helpers instead of `instanceof`; propose externalizing aas-core in the SDK build |
| aas-core 1.0.1 ESM build fails in plain Node | Confirm bundler behavior in phase 0; report upstream |
| `*.localhost` doesn't resolve on some Linux hosts or CI | Documented `/etc/hosts` entry in the test environment README |
| No Studio session hardening beyond MVP-1 | Hosted MVP-1 builds are not exposed publicly until the session ADR is implemented |

## After MVP-1

- **MVP-2:**
  - one property edit, save and reload, with revision and conflict results and
    drafts kept per target;
  - porting the BaSyx AAS Web UI components onto Studio composables, replacing
    `useRequestHandling`, the clients, and the global stores rather than
    wrapping them;
  - porting the infrastructure management UI.
- **MVP-3:** registry and discovery resolution, cross-target copy, and
  runtime-installable modules and apps.

Open question for MVP-2: which BaSyx AAS Web UI codebase is the source for
components, upstream `main` or a fork branch.
