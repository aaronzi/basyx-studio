# 0052: Outbound requests through an HTTP proxy

- Status: Proposed
- Date: 2026-10-26
- Deciders: BaSyx Studio maintainers
- Requirements: SEC-008, DEP-001, DEP-005

## Context

Studio's server makes every outbound request through one guarded fetch
(`server/lib/network/guarded-fetch.ts`): AAS infrastructures and their
registries, OIDC discovery and token endpoints for the login and for the
credential broker's token exchange, connections and their tests (InfluxDB 2,
`http` connections with declared operations, [ADR 0040](0040-connections-on-infrastructures.md)
and [ADR 0047](0047-http-connections-for-apps.md)), and external files
([ADR 0042](0042-external-files-through-studio.md)). It checks the origin
allowlist and the address policy, re-checks the resolved address when it
connects (against DNS rebinding), never follows redirects, and bounds time
and size (SEC-008). Its agents connect directly.

Many hosted clusters let pods reach external hosts only through an HTTP
proxy, named by the conventional `HTTP_PROXY`, `HTTPS_PROXY` and `NO_PROXY`
variables. Studio read none of them, so every request to an external host
timed out, while in-cluster services and the deployment's own host must
keep going direct. Node's built-in fetch ignores the variables too, and its
`NODE_USE_ENV_PROXY` does not apply to the undici package that the guarded
fetch uses for its dispatchers.

## Decision

- **Read once at startup** (`server/lib/config.ts`, parsed in
  `server/lib/network/proxy.ts`): `HTTP_PROXY` for http targets,
  `HTTPS_PROXY` for https targets (else `HTTP_PROXY`), and `NO_PROXY`; the
  lower-case variants take precedence, as in curl and undici. A proxy URL is
  `http://` or `https://` with host and port, optionally with credentials;
  without a scheme it means `http://`. Anything else stops startup with a
  configuration error. Changes need a restart.
- **`NO_PROXY`** lists, separated by commas or whitespace: `*` for every
  host; a host, matching itself and its subdomains (`example.com`,
  `.example.com`); `*.example.com` for subdomains only; IP addresses
  (`10.0.0.5`, `[fd00::1]`); CIDR ranges (`10.0.0.0/8`, `fd00::/8`), which
  match IP literals only, as Studio never resolves a name to decide; each
  optionally with a port (`aas.example.com:8443`). Loopback (`localhost`,
  `*.localhost`, `127.0.0.0/8`, `::1`) always goes direct.
- **One more dispatcher.** Requests to a proxied host use undici's
  `ProxyAgent`: CONNECT tunnels for https, with the TLS session, server
  certificate check and client certificate ([ADR 0025](0025-client-certificates-for-infrastructures.md))
  end to end with the target; absolute-form forwarding for http. Agents are
  cached per policy, protocol, certificate and route, as before.
- **The guards apply to the target, before the proxy sees the request:**
  the origin allowlist, the static URL rules, the address policy for IP
  literals and for every address a name resolves to, the timeout (which
  covers the proxy) and the size cap. Redirects are never followed and are
  validated by the callers that follow them, as before.
- **The proxy is not a target.** It is the deployment's own configuration,
  so its address, typically private, does not count against the
  private-network policy, and plain HTTP to it is allowed: https targets
  stay encrypted end to end inside the tunnel.
- **DNS when the proxy resolves.** Studio still resolves a proxied name for
  the pre-flight check and refuses it if any address is forbidden or, without
  `allowPrivateNetwork`, private. Where the pod cannot resolve external names,
  an https request goes on and the proxy resolves the name; Studio cannot
  then see the address. A plain http target must always resolve locally,
  because plain HTTP may only reach private networks. Studio never connects
  to a proxied target itself, so the connect-time re-check against DNS
  rebinding does not apply to it; between the check and the proxy's own
  lookup, the answer could change.
- **Credentials never reach the log.** The startup line names the proxies as
  `http://***@proxy:3128`; configuration errors and failure messages never
  repeat the proxy URL with its credentials. A tunnel that the proxy refuses
  fails as `unreachable` with the proxy's status, e.g. HTTP 403 or 407.

## Consequences

- Studio works in clusters with proxy-only egress, with the variables that
  the platform usually injects already. Without them, nothing changes.
- In-cluster services must be in `NO_PROXY`: their domains (`.svc`,
  `.cluster.local`), short service names (exactly, as they contain no dot)
  and the pod and service CIDR ranges for IP targets. A target missing there
  goes to the proxy and, for plain http, usually fails.
- For names that only the proxy resolves, the private-network policy is as
  strong as the proxy's own egress rules: a name that resolves to an
  internal address at the proxy, but not in the pod, reaches what the proxy
  reaches. Deployments that need the policy for every name keep external DNS
  resolvable in the pod, and restrict the proxy to external destinations.
  IP literals, including cloud metadata addresses, are always refused.
- The TLS diagnostic handshake after a failed request (which reads the
  server's alert about a client certificate) goes through a tunnel too.
- Desktop reads the same variables from the environment it starts in; it
  does not read the operating system's proxy settings or PAC files.

## Alternatives considered

- **undici's `EnvHttpProxyAgent`:** reads the same variables from
  `process.env` itself and has no CIDR ranges; it would replace the guarded
  agents rather than compose with them, so the guarded lookup would need a
  second agent per route all the same.
- **`NODE_USE_ENV_PROXY` / `--use-env-proxy`:** covers Node's built-in fetch
  and `http` only, not the dispatchers of the undici package, and would also
  route Studio's internal requests.
- **Refusing names that do not resolve in the pod:** keeps the DNS-based
  check for every name, but fails exactly in the clusters that need a proxy,
  where pods often cannot resolve external names.
- **A Studio-specific variable (`STUDIO_HTTPS_PROXY`):** explicit, but
  platforms inject the conventional names, and a second set would confuse
  more than it clarifies.
- **SOCKS or PAC:** not needed for the clusters at hand; undici supports
  SOCKS5 if a later decision wants it.
