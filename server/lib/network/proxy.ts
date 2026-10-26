import { BlockList, isIP } from 'node:net'

/**
 * One NO_PROXY entry. `host` is lower-case without brackets or a trailing
 * dot; `subdomainsOnly` for `*.example.com`; IP addresses and CIDR ranges
 * are `ranges`, compared by value; `port` 0 for any port.
 */
export type NoProxyEntry
  = | { kind: 'any', port: number }
    | { kind: 'host', host: string, subdomainsOnly: boolean, port: number }
    | { kind: 'range', ranges: BlockList, port: number }

/** The deployment's outbound proxy (ADR 0052), read once at startup. */
export interface OutboundProxy {
  /** For http targets (HTTP_PROXY); `null` sends them direct. */
  http: URL | null
  /** For https targets (HTTPS_PROXY, else HTTP_PROXY); `null` sends them direct. */
  https: URL | null
  /** Targets that bypass the proxy (NO_PROXY), besides loopback, which always does. */
  noProxy: NoProxyEntry[]
  /** NO_PROXY as given, for the startup log. */
  noProxyText: string
}

export class ProxyConfigurationError extends Error {}

const defaultPorts: Record<string, number> = { 'http:': 80, 'https:': 443 }

/** The value of a proxy variable, lower case first as curl and undici read them. */
function variable (env: NodeJS.ProcessEnv, name: string): string | undefined {
  const value = env[name.toLowerCase()] ?? env[name]
  return value?.trim() || undefined
}

/**
 * A proxy URL; `proxy:3128` without a scheme means plain HTTP to the proxy.
 * Error messages never repeat the value, which may contain credentials.
 */
function parseProxyUrl (value: string, name: string): URL {
  const url = URL.parse(/^[a-z][\d+.a-z-]*:\/\//i.test(value) ? value : `http://${value}`)
  if (!url || !url.hostname) {
    throw new ProxyConfigurationError(`${name} is not a valid proxy URL.`)
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ProxyConfigurationError(`${name} must be an http:// or https:// proxy URL, not ${url.protocol}//.`)
  }
  if ((url.pathname !== '/' && url.pathname !== '') || url.search || url.hash) {
    throw new ProxyConfigurationError(`${name} must name only the proxy's scheme, host and port.`)
  }
  return url
}

function unbracket (host: string): string {
  return host.replace(/^\[(.+)\]$/, '$1')
}

function parseRange (value: string): BlockList | null {
  const match = /^(.+)\/(\d{1,3})$/.exec(value)
  if (!match) {
    return null
  }
  const address = unbracket(match[1]!)
  const family = isIP(address)
  const prefix = Number(match[2])
  if (family === 0 || prefix > (family === 4 ? 32 : 128)) {
    return null
  }
  const ranges = new BlockList()
  ranges.addSubnet(address, prefix, family === 4 ? 'ipv4' : 'ipv6')
  return ranges
}

function parseNoProxyEntry (entry: string): NoProxyEntry {
  // A port follows a host, a bracketed IPv6 address or a range; a bare IPv6
  // address has more than one colon and never carries one.
  let host = entry
  let port = 0
  const bracketed = /^(\[[^\]]+\](?:\/\d+)?):(\d+)$/.exec(entry)
  const plain = /^([^:]+):(\d+)$/.exec(entry)
  const withPort = bracketed ?? plain
  if (withPort) {
    host = withPort[1]!
    port = Number(withPort[2])
    if (port < 1 || port > 65_535) {
      throw new ProxyConfigurationError(`NO_PROXY: ${entry} has an invalid port.`)
    }
  }
  if (host === '*') {
    return { kind: 'any', port }
  }
  if (host.includes('/')) {
    const ranges = parseRange(host)
    if (!ranges) {
      throw new ProxyConfigurationError(`NO_PROXY: ${entry} is not a valid CIDR range.`)
    }
    return { kind: 'range', ranges, port }
  }
  const address = unbracket(host)
  const family = isIP(address)
  if (family !== 0) {
    // By value, as URLs canonicalize addresses: [fd00:0::1] is https://[fd00::1].
    const ranges = new BlockList()
    ranges.addAddress(address, family === 4 ? 'ipv4' : 'ipv6')
    return { kind: 'range', ranges, port }
  }
  const subdomainsOnly = host.startsWith('*.')
  const name = address.replace(/^\*?\./, '').replace(/\.$/, '').toLowerCase()
  if (!name) {
    throw new ProxyConfigurationError(`NO_PROXY: ${entry} names no host.`)
  }
  return { kind: 'host', host: name, subdomainsOnly, port }
}

/** NO_PROXY entries, separated by commas or whitespace. */
export function parseNoProxy (value: string): NoProxyEntry[] {
  return value.split(/[\s,]+/).filter(Boolean).map(entry => parseNoProxyEntry(entry))
}

/**
 * The outbound proxy of the environment: HTTP_PROXY, HTTPS_PROXY and
 * NO_PROXY, each also in lower case, which takes precedence. `null` when
 * neither proxy variable is set.
 */
export function parseOutboundProxy (env: NodeJS.ProcessEnv): OutboundProxy | null {
  const httpValue = variable(env, 'HTTP_PROXY')
  const httpsValue = variable(env, 'HTTPS_PROXY')
  if (!httpValue && !httpsValue) {
    return null
  }
  const http = httpValue ? parseProxyUrl(httpValue, 'HTTP_PROXY') : null
  const https = httpsValue ? parseProxyUrl(httpsValue, 'HTTPS_PROXY') : http
  const noProxyText = variable(env, 'NO_PROXY') ?? ''
  return { http, https, noProxy: parseNoProxy(noProxyText), noProxyText }
}

function isLoopback (host: string): boolean {
  if (host === 'localhost' || host.endsWith('.localhost')) {
    return true
  }
  const family = isIP(host)
  return (family === 4 && host.startsWith('127.')) || host === '::1'
}

function matches (entry: NoProxyEntry, host: string, port: number): boolean {
  if (entry.port !== 0 && entry.port !== port) {
    return false
  }
  if (entry.kind === 'any') {
    return true
  }
  if (entry.kind === 'range') {
    // Ranges match IP literals only; Studio does not resolve names to decide.
    const family = isIP(host)
    return family !== 0 && entry.ranges.check(host, family === 4 ? 'ipv4' : 'ipv6')
  }
  return (!entry.subdomainsOnly && host === entry.host) || host.endsWith(`.${entry.host}`)
}

/**
 * The proxy for a request to `url`, or `null` to connect directly: when no
 * proxy is configured for its protocol, for loopback hosts, and for hosts
 * that NO_PROXY lists.
 */
export function proxyFor (url: URL, proxy: OutboundProxy | null): URL | null {
  const selected = url.protocol === 'https:' ? proxy?.https : (url.protocol === 'http:' ? proxy?.http : null)
  if (!proxy || !selected) {
    return null
  }
  const host = unbracket(url.hostname).replace(/\.$/, '').toLowerCase()
  const port = Number(url.port) || defaultPorts[url.protocol]!
  if (isLoopback(host) || proxy.noProxy.some(entry => matches(entry, host, port))) {
    return null
  }
  return selected
}

/** A proxy URL for logs and messages, without the credentials it may contain. */
export function redactProxyUrl (url: URL): string {
  return `${url.protocol}//${url.username || url.password ? '***@' : ''}${url.host}`
}

/** One line for the startup log; never contains proxy credentials. */
export function describeOutboundProxy (proxy: OutboundProxy): string {
  const parts = [
    `http targets ${proxy.http ? `through ${redactProxyUrl(proxy.http)}` : 'direct'}`,
    `https targets ${proxy.https ? `through ${redactProxyUrl(proxy.https)}` : 'direct'}`,
  ]
  const bypass = proxy.noProxyText ? `loopback and NO_PROXY (${proxy.noProxyText}) direct` : 'loopback direct'
  return `outbound proxy: ${parts.join(', ')}; ${bypass}`
}
