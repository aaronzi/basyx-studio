import type { TestIdentity } from '../support/pki'
import type { IncomingHttpHeaders, Server } from 'node:http'
import type { Socket } from 'node:net'
import type { OutboundPolicy } from '~~/server/lib/network/guarded-fetch'
import { randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import { createServer as createHttpsServer } from 'node:https'
import { connect, createServer as createTcpServer } from 'node:net'
import { getCACertificates, setDefaultCACertificates } from 'node:tls'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { ConfigurationError, loadStudioConfig } from '~~/server/lib/config'
import { agentKey, checkHost, configureOutboundProxy, createGuardedFetch, NetworkFailure } from '~~/server/lib/network/guarded-fetch'
import { describeOutboundProxy, parseOutboundProxy, proxyFor, redactProxyUrl } from '~~/server/lib/network/proxy'
import { createCa, issueClient, issueServer, startMutualTlsServer } from '../support/pki'

function proxied (env: NodeJS.ProcessEnv, url: string): string | null {
  return proxyFor(new URL(url), parseOutboundProxy(env))?.href ?? null
}

describe('outbound proxy variables', () => {
  it('is off unless a proxy variable is set', () => {
    expect(parseOutboundProxy({})).toBeNull()
    expect(parseOutboundProxy({ NO_PROXY: '*' })).toBeNull()
    expect(parseOutboundProxy({ HTTPS_PROXY: '  ' })).toBeNull()
  })

  it('reads the lower-case variants first and falls back from HTTPS_PROXY to HTTP_PROXY', () => {
    const proxy = parseOutboundProxy({ HTTP_PROXY: 'http://upper:3128', http_proxy: 'http://lower:3128' })!
    expect(proxy.http?.href).toBe('http://lower:3128/')
    expect(proxy.https?.href).toBe('http://lower:3128/')
    expect(parseOutboundProxy({ HTTPS_PROXY: 'http://secure:3128' })!.http).toBeNull()
    expect(parseOutboundProxy({ NO_PROXY: '.upper', no_proxy: '.lower', HTTPS_PROXY: 'http://p:1' })!.noProxyText).toBe('.lower')
  })

  it('takes a proxy without a scheme as plain HTTP to the proxy', () => {
    expect(parseOutboundProxy({ HTTPS_PROXY: 'proxy.internal:3128' })!.https?.href).toBe('http://proxy.internal:3128/')
    expect(parseOutboundProxy({ HTTPS_PROXY: 'https://proxy.internal' })!.https?.href).toBe('https://proxy.internal/')
  })

  it('rejects other schemes, paths and invalid NO_PROXY entries without repeating credentials', () => {
    const invalid = [
      { HTTPS_PROXY: 'socks5://user:s3cret@proxy:1080' },
      { HTTPS_PROXY: 'http://user:s3cret@proxy:3128/path' },
      { HTTPS_PROXY: 'http://user:s3cret@[::1' },
      { HTTPS_PROXY: 'http://proxy:3128', NO_PROXY: '10.0.0.0/33' },
      { HTTPS_PROXY: 'http://proxy:3128', NO_PROXY: 'example.com:0' },
    ]
    for (const env of invalid) {
      expect(() => loadStudioConfig({ STUDIO_DATA_KEY: randomBytes(32).toString('base64url'), ...env }, 'desktop')).toThrow(ConfigurationError)
      expect(() => parseOutboundProxy(env)).toThrow(/^(?!.*s3cret)/)
    }
  })

  it('reaches the Studio configuration', () => {
    const config = loadStudioConfig({ STUDIO_DATA_KEY: randomBytes(32).toString('base64url'), https_proxy: 'http://proxy:3128', no_proxy: '.svc' }, 'desktop')
    expect(config.outboundProxy?.https?.host).toBe('proxy:3128')
    expect(loadStudioConfig({ STUDIO_DATA_KEY: randomBytes(32).toString('base64url') }, 'desktop').outboundProxy).toBeNull()
  })

  it('describes the proxy for the log without its credentials', () => {
    const proxy = parseOutboundProxy({ HTTPS_PROXY: 'http://user:s3cret@proxy.internal:3128', NO_PROXY: '.svc,10.0.0.0/8' })!
    expect(redactProxyUrl(proxy.https!)).toBe('http://***@proxy.internal:3128')
    expect(describeOutboundProxy(proxy)).toBe('outbound proxy: http targets direct, https targets through http://***@proxy.internal:3128; loopback and NO_PROXY (.svc,10.0.0.0/8) direct')
  })
})

describe('proxy selection', () => {
  const env = { HTTP_PROXY: 'http://plain-proxy:3128', HTTPS_PROXY: 'http://tls-proxy:3128' }

  it('picks the proxy by the protocol of the target', () => {
    expect(proxied(env, 'https://aas.example.com/shells')).toBe('http://tls-proxy:3128/')
    expect(proxied(env, 'http://aas.example.com/shells')).toBe('http://plain-proxy:3128/')
    expect(proxied({ HTTPS_PROXY: 'http://tls-proxy:3128' }, 'http://aas.example.com/')).toBeNull()
  })

  it('always connects to loopback directly', () => {
    for (const url of ['https://localhost:8081', 'https://studio.localhost', 'https://127.0.0.1', 'https://127.10.0.1', 'https://[::1]:8443']) {
      expect(proxied(env, url)).toBeNull()
    }
  })

  it('bypasses the proxy for exact hosts and domain suffixes', () => {
    const noProxy = { ...env, NO_PROXY: 'idp.example.org, .svc.cluster.local internal.example.com.' }
    expect(proxied(noProxy, 'https://idp.example.org')).toBeNull()
    expect(proxied(noProxy, 'https://IDP.Example.org.')).toBeNull()
    expect(proxied(noProxy, 'https://basyx.studio.svc.cluster.local:8081')).toBeNull()
    expect(proxied(noProxy, 'https://svc.cluster.local')).toBeNull()
    expect(proxied(noProxy, 'https://a.internal.example.com')).toBeNull()
    expect(proxied(noProxy, 'https://login.idp.example.org')).toBeNull()
    expect(proxied(noProxy, 'https://notidp.example.org')).toBe('http://tls-proxy:3128/')
    expect(proxied(noProxy, 'https://example.com')).toBe('http://tls-proxy:3128/')
  })

  it('matches only subdomains for *.domain', () => {
    const noProxy = { ...env, NO_PROXY: '*.example.com' }
    expect(proxied(noProxy, 'https://a.example.com')).toBeNull()
    expect(proxied(noProxy, 'https://example.com')).toBe('http://tls-proxy:3128/')
  })

  it('restricts entries with a port to that port, counting default ports', () => {
    const noProxy = { ...env, NO_PROXY: 'aas.example.com:8443,files.example.com:443,[fd00::1]:8081,*:9000' }
    expect(proxied(noProxy, 'https://aas.example.com:8443')).toBeNull()
    expect(proxied(noProxy, 'https://aas.example.com')).toBe('http://tls-proxy:3128/')
    expect(proxied(noProxy, 'https://files.example.com')).toBeNull()
    expect(proxied(noProxy, 'https://[fd00::1]:8081')).toBeNull()
    expect(proxied(noProxy, 'https://[fd00::1]:8082')).toBe('http://tls-proxy:3128/')
    expect(proxied(noProxy, 'https://anything.example.net:9000')).toBeNull()
  })

  it('bypasses the proxy for every host with *', () => {
    expect(proxied({ ...env, NO_PROXY: 'example.org,*' }, 'https://aas.example.com')).toBeNull()
  })

  it('matches CIDR ranges and addresses against IP literals only', () => {
    const noProxy = { ...env, NO_PROXY: '10.0.0.0/8,192.168.1.10,fd00::/8,[2001:db8::1]' }
    expect(proxied(noProxy, 'https://10.43.2.7:8081')).toBeNull()
    expect(proxied(noProxy, 'https://11.0.0.1')).toBe('http://tls-proxy:3128/')
    expect(proxied(noProxy, 'https://192.168.1.10')).toBeNull()
    expect(proxied(noProxy, 'https://192.168.1.11')).toBe('http://tls-proxy:3128/')
    expect(proxied(noProxy, 'https://[fd12::7]')).toBeNull()
    expect(proxied(noProxy, 'https://[2001:db8::1]')).toBeNull()
    // A name is never resolved to decide, even if it would resolve into a range.
    expect(proxied(noProxy, 'https://ten.example.com')).toBe('http://tls-proxy:3128/')
  })

  it('keeps proxied and direct agents apart', () => {
    const policy = { allowedOrigins: new Set<string>(), allowPrivateNetwork: false, timeoutMs: 1000, maxResponseBytes: 1000 }
    expect(agentKey(policy, 'https:', true)).not.toBe(agentKey(policy, 'https:'))
  })
})

interface ProxyRequest {
  method: string
  url: string
  headers: IncomingHttpHeaders
}

/** A forward proxy on 127.0.0.1 that tunnels every CONNECT to `targetPort` on 127.0.0.1, or refuses with `refuseWith`. */
async function startConnectProxy (targetPort: () => number): Promise<{ url: string, requests: ProxyRequest[], refuseWith: { status: number | null }, close: () => Promise<void> }> {
  const requests: ProxyRequest[] = []
  const refuseWith = { status: null as number | null }
  const server: Server = createServer((request, response) => {
    requests.push({ method: request.method!, url: request.url!, headers: request.headers })
    response.writeHead(502).end()
  })
  server.on('connect', (request, socket, head) => {
    requests.push({ method: request.method!, url: request.url!, headers: request.headers })
    if (refuseWith.status) {
      socket.end(`HTTP/1.1 ${refuseWith.status} Refused\r\n\r\n`)
      return
    }
    const upstream = connect(targetPort(), '127.0.0.1', () => {
      socket.write('HTTP/1.1 200 Connection Established\r\n\r\n')
      upstream.write(head)
      upstream.pipe(socket)
      socket.pipe(upstream)
    })
    upstream.on('error', () => socket.destroy())
    socket.on('error', () => upstream.destroy())
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    refuseWith,
    close: () => new Promise(resolve => {
      server.closeAllConnections()
      server.close(() => resolve())
    }),
  }
}

async function failureOf (promise: Promise<unknown>): Promise<NetworkFailure> {
  const error = await promise.then(() => undefined, (error_: unknown) => error_)
  expect(error).toBeInstanceOf(NetworkFailure)
  return error as NetworkFailure
}

// `.invalid` never resolves (RFC 6761), as external names do not in a
// network that reaches them only through the proxy.
const targetHost = 'aas.studio-proxy-test.invalid'
const targetOrigin = `https://${targetHost}`

describe('guarded fetch through a CONNECT proxy', () => {
  const defaultCas = getCACertificates('default')
  let ca: TestIdentity
  let client: TestIdentity
  let target: ReturnType<typeof createHttpsServer>
  let targetPort = 0
  let mutualTls: { url: string, close: () => Promise<void> }
  let tunnelTo = () => targetPort
  let proxy: Awaited<ReturnType<typeof startConnectProxy>>

  beforeAll(async () => {
    ca = createCa('Studio Proxy Test CA')
    client = issueClient(ca, 'Studio Proxy Test Client')
    const server = issueServer(ca, [targetHost])
    setDefaultCACertificates([...defaultCas, ca.certPem])
    target = createHttpsServer({ key: server.keyPem, cert: server.certPem }, (request, response) => {
      if (request.url === '/redirect') {
        response.writeHead(302, { location: 'https://elsewhere.example.com/' }).end()
      } else if (request.url === '/large') {
        response.end('x'.repeat(5000))
      } else {
        response.setHeader('content-type', 'application/json')
        response.end(JSON.stringify({ path: request.url, host: request.headers.host }))
      }
    })
    await new Promise<void>(resolve => target.listen(0, '127.0.0.1', resolve))
    targetPort = (target.address() as { port: number }).port
    mutualTls = await startMutualTlsServer(server, ca)
    proxy = await startConnectProxy(() => tunnelTo())
  })

  afterEach(() => {
    configureOutboundProxy(null)
    proxy.requests.length = 0
    proxy.refuseWith.status = null
    tunnelTo = () => targetPort
  })

  afterAll(async () => {
    setDefaultCACertificates(defaultCas)
    target?.closeAllConnections()
    await new Promise(resolve => target?.close(resolve))
    await mutualTls?.close()
    await proxy?.close()
  })

  function useProxy (env: NodeJS.ProcessEnv = {}): void {
    const proxyUrl = new URL(proxy.url)
    proxyUrl.username = 'studio'
    proxyUrl.password = 's3cret'
    configureOutboundProxy(parseOutboundProxy({ HTTPS_PROXY: proxyUrl.href, ...env }))
  }

  // The policy of a hosted deployment: no private-network targets, although
  // the proxy itself listens on loopback.
  function policy (overrides: Partial<OutboundPolicy> = {}): OutboundPolicy {
    return { allowedOrigins: new Set([targetOrigin]), allowPrivateNetwork: false, timeoutMs: 5000, maxResponseBytes: 1000, ...overrides }
  }

  it('tunnels to a name that only the proxy resolves, with the proxy credentials', async () => {
    useProxy()
    const response = await createGuardedFetch(policy())(`${targetOrigin}/shells`)
    expect(await response.json()).toEqual({ path: '/shells', host: targetHost })
    expect(proxy.requests).toEqual([expect.objectContaining({ method: 'CONNECT', url: `${targetHost}:443` })])
    expect(proxy.requests[0]!.headers['proxy-authorization']).toBe(`Basic ${Buffer.from('studio:s3cret').toString('base64')}`)
  })

  it('accepts the name in the pre-flight check only when it goes through the proxy', async () => {
    await expect(checkHost(new URL(targetOrigin), { allowPrivateNetwork: false })).rejects.toMatchObject({ kind: 'unreachable' })
    useProxy()
    await expect(checkHost(new URL(targetOrigin), { allowPrivateNetwork: false })).resolves.toBeUndefined()
    // Plain HTTP must resolve here: it may only reach private networks.
    await expect(checkHost(new URL(`http://${targetHost}`), { allowPrivateNetwork: true })).rejects.toMatchObject({ kind: 'unreachable' })
  })

  it('presents the client certificate to the target through the tunnel', async () => {
    useProxy()
    tunnelTo = () => Number(new URL(mutualTls.url).port)
    const clientCertificate = { identity: 'proxy-test', key: client.keyPem, cert: client.certPem }
    const response = await createGuardedFetch(policy({ clientCertificate }))(`${targetOrigin}/description`)
    expect(response.status).toBe(200)
    const failure = await failureOf(createGuardedFetch(policy())(`${targetOrigin}/description`))
    expect(failure.kind).toBe('client_certificate_required')
    // The diagnostic handshake after the failure tunnels through the proxy too.
    expect(proxy.requests.length).toBeGreaterThan(2)
    expect(proxy.requests.every(request => request.method === 'CONNECT' && request.headers['proxy-authorization'])).toBe(true)
  })

  it('still blocks forbidden and private addresses before contacting the proxy', async () => {
    useProxy()
    for (const url of ['https://169.254.169.254', 'https://10.0.0.1', 'https://[fd00::1]']) {
      const failure = await failureOf(createGuardedFetch(policy({ allowedOrigins: new Set([new URL(url).origin]) }))(`${url}/latest/meta-data`))
      expect(failure.kind).toBe('blocked')
    }
    expect(proxy.requests).toEqual([])
  })

  it('still enforces the origin allowlist, redirects and the size cap', async () => {
    useProxy()
    expect((await failureOf(createGuardedFetch(policy())('https://other.studio-proxy-test.invalid/'))).kind).toBe('blocked')
    expect((await failureOf(createGuardedFetch(policy())(`${targetOrigin}/redirect`))).message).toMatch(/redirect to https:\/\/elsewhere\.example\.com\/ was not followed/)
    expect((await failureOf(createGuardedFetch(policy())(`${targetOrigin}/large`).then(response => response.text()))).kind).toBe('too_large')
  })

  it('reports a refused tunnel without the proxy credentials', async () => {
    useProxy()
    proxy.refuseWith.status = 403
    const failure = await failureOf(createGuardedFetch(policy())(`${targetOrigin}/shells`))
    expect(failure.kind).toBe('unreachable')
    expect(failure.message).toBe(`the outbound proxy http://***@${new URL(proxy.url).host} refused the connection to ${targetOrigin} with HTTP 403`)
    expect(failure.message).not.toContain('s3cret')
  })

  it('times out through the proxy', async () => {
    useProxy()
    // A tunnel to a port that accepts but never answers TLS.
    const sockets: Socket[] = []
    const silent = createTcpServer(socket => sockets.push(socket))
    await new Promise<void>(resolve => silent.listen(0, '127.0.0.1', resolve))
    tunnelTo = () => (silent.address() as { port: number }).port
    try {
      const failure = await failureOf(createGuardedFetch(policy({ timeoutMs: 300 }))(`${targetOrigin}/shells`))
      expect(failure.kind).toBe('timeout')
    } finally {
      for (const socket of sockets) {
        socket.destroy()
      }
      await new Promise(resolve => silent.close(resolve))
    }
  })

  it('connects directly to hosts in NO_PROXY', async () => {
    useProxy({ NO_PROXY: '.invalid' })
    const failure = await failureOf(createGuardedFetch(policy())(`${targetOrigin}/shells`))
    expect(failure.kind).toBe('unreachable')
    expect(failure.message).toBe(`host ${targetHost} could not be resolved`)
    expect(proxy.requests).toEqual([])
  })
})
