import type { Connection, ConnectionCallWireParams } from '#shared/contract'
import type { ConnectionApi } from '@basyx/studio-app-kit/manifest'
import type { AppManifest } from '@basyx/studio-sdk/protocol'
import type { AddressInfo } from 'node:net'
import type { HttpCall } from '~~/server/lib/connections/http'
import type { DatabaseHandle } from '~~/server/lib/database/client'
import type { Actor, StudioDeps } from '~~/server/lib/deps'
import type { InfrastructureRecord } from '~~/server/lib/infrastructures'
import { randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import { checkConnectionApis } from '@basyx/studio-app-kit/manifest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { auditEvents, infrastructures, studioSessions, targetCredentials } from '~~/server/database/schema'
import { loadStudioConfig } from '~~/server/lib/config'
import { buildHttpRequest, callHttpConnection, CallLimiter, callResult, locationBelow } from '~~/server/lib/connections/http'
import { testConnection } from '~~/server/lib/connections/test'
import { SecretCipher } from '~~/server/lib/crypto/cipher'
import { openDatabase } from '~~/server/lib/database/client'
import { applyMigrations, loadMigrationsFromDirectory } from '~~/server/lib/database/migrate'
import { forgetOidcClients } from '~~/server/lib/oidc/client'
import { CredentialBroker } from '~~/server/lib/targets/credentials'
import { connectionCallParamsSchema, connectionInputSchema, decodeConnectionResult, encodeConnectionCall, infrastructureInputSchema } from '#shared/contract'

const migrationsDirectory = new URL('../../server/database/migrations', import.meta.url).pathname

/** An OpenAPI 3.0 document of a small work-order service, with references, nullable fields and every kind of body. */
const orders = {
  openapi: '3.0.3',
  info: { title: 'Work orders', version: '1.0.0' },
  servers: [{ url: 'https://ignored.example.org' }],
  paths: {
    '/orders': {
      get: {
        operationId: 'listOrders',
        summary: 'List work orders',
        parameters: [
          { $ref: '#/components/parameters/Asset' },
          { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100 } },
          { name: 'status', in: 'query', schema: { type: 'array', items: { type: 'string', enum: ['open', 'done'] } } },
        ],
        responses: { 200: { description: 'ok', content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/Order' } } } } } },
      },
      post: {
        operationId: 'createOrder',
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/NewOrder' } } } },
        responses: { 201: { description: 'created', content: { 'application/json': { schema: { $ref: '#/components/schemas/Order' } } } } },
      },
      delete: { operationId: 'deleteAll', responses: { 204: { description: 'gone' } } },
    },
    '/orders/{orderId}': {
      parameters: [{ name: 'orderId', in: 'path', required: true, schema: { type: 'string' } }],
      get: { operationId: 'getOrder', responses: { 200: { description: 'ok', content: { 'application/json': {} } }, 404: { description: 'missing', content: { 'application/problem+json': {} } } } },
      put: {
        operationId: 'replaceOrder',
        parameters: [{ name: 'If-Match', in: 'header', required: true, schema: { type: 'string' } }],
        requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/NewOrder' } }, 'text/plain': {} } },
        responses: { 200: { description: 'ok' } },
      },
    },
    '/orders/{orderId}/photo': {
      parameters: [{ name: 'orderId', in: 'path', required: true, schema: { type: 'string' } }],
      put: { operationId: 'putPhoto', requestBody: { content: { 'image/*': {} } }, responses: { 204: { description: 'stored' } } },
      get: { operationId: 'getPhoto', responses: { 200: { description: 'the photo', content: { 'image/png': {} } } } },
    },
    '/orders/{orderId}/attachments': {
      parameters: [{ name: 'orderId', in: 'path', required: true, schema: { type: 'string' } }],
      post: {
        operationId: 'addAttachment',
        requestBody: {
          content: {
            'multipart/form-data': {
              schema: {
                type: 'object',
                required: ['file'],
                additionalProperties: false,
                properties: { note: { type: 'string', maxLength: 20 }, pages: { type: 'integer' }, file: { type: 'string', format: 'binary' } },
              },
            },
          },
        },
        responses: { 201: { description: 'added' } },
      },
    },
    '/search': {
      post: {
        operationId: 'search',
        requestBody: { content: { 'application/x-www-form-urlencoded': { schema: { type: 'object', properties: { q: { type: 'string' } } } } } },
        responses: { 200: { description: 'ok' } },
      },
    },
    '/hidden': { get: { operationId: 'notListed', responses: { 200: { description: 'ok' } } } },
  },
  components: {
    parameters: { Asset: { name: 'asset', in: 'query', required: true, schema: { type: 'string', minLength: 1 } } },
    schemas: {
      NewOrder: {
        type: 'object',
        required: ['title'],
        additionalProperties: false,
        properties: { title: { type: 'string', minLength: 1 }, due: { type: 'string', format: 'date', nullable: true }, priority: { type: 'integer', minimum: 0, exclusiveMinimum: true } },
      },
      Order: { allOf: [{ $ref: '#/components/schemas/NewOrder' }, { type: 'object', properties: { id: { type: 'string' } } }] },
    },
  },
}

const listed = ['listOrders', 'createOrder', 'deleteAll', 'getOrder', 'replaceOrder', 'putPhoto', 'getPhoto', 'addAttachment', 'search']

function manifestWith (api: unknown, operations = listed): { manifest: AppManifest, read: (path: string) => string | undefined } {
  const manifest = {
    manifestVersion: 0,
    id: 'org.example.orders',
    version: '1.0.0',
    publisher: { name: 'Example' },
    title: { en: 'Orders' },
    studioApi: '^0.1.6',
    runtimes: ['hosted'],
    permissions: ['studio.connections'],
    connections: [{ id: 'orders', title: { en: 'Work orders' }, api: 'api/orders.json', operations }],
    contributes: { modules: [{ id: 'main', title: { en: 'Orders' }, entry: 'ui/index.html', route: 'orders', context: 'target' }] },
  } satisfies AppManifest
  return { manifest, read: path => path === 'api/orders.json' ? (typeof api === 'string' ? api : JSON.stringify(api)) : undefined }
}

function apisOf (api: unknown = orders): Map<string, ConnectionApi> {
  const { manifest, read } = manifestWith(api)
  const checked = checkConnectionApis(manifest, read)
  expect(checked.findings).toEqual([])
  return checked.apis
}

describe('the OpenAPI documents of app connections', () => {
  it('indexes the listed operations with their parameters, bodies and response media types', () => {
    const api = apisOf().get('orders')!
    expect([...api.index.operations.keys()]).toEqual(expect.arrayContaining(listed))
    expect(api.index.operations.has('notListed')).toBe(false)
    expect(api.index.operations.get('replaceOrder')).toMatchObject({
      method: 'PUT',
      path: '/orders/{orderId}',
      parameters: [{ name: 'orderId', in: 'path', required: true }, { name: 'If-Match', in: 'header', required: true }],
      requestBody: { required: false, content: [{ mediaType: 'application/json' }, { mediaType: 'text/plain', schema: null }] },
    })
    expect(api.index.operations.get('listOrders')!.parameters.find(parameter => parameter.name === 'status')).toMatchObject({ array: true, explode: true })
    expect(api.index.operations.get('getOrder')!.responseMediaTypes).toEqual(['application/json', 'application/problem+json'])
  })

  it('reports what Studio cannot send, as studio-app pack and the upload do', () => {
    const broken = structuredClone(orders) as Record<string, any>
    broken.paths['/orders'].get.parameters.push({ name: 'session', in: 'cookie', schema: { type: 'string' } }, { name: 'filter', in: 'query', style: 'deepObject', schema: { type: 'object' } }, { name: 'Authorization', in: 'header', schema: { type: 'string' } })
    broken.paths['/orders'].get.requestBody = { content: { 'application/json': {} } }
    broken.paths['/orders/{orderId}/photo'].get.parameters = [{ name: 'size', in: 'path', required: true, schema: { type: 'string' } }]
    broken.components.schemas.Order = { $ref: 'common.json#/Order' }
    const { manifest, read } = manifestWith(broken, [...listed, 'missing'])
    const messages = checkConnectionApis(manifest, read).findings.map(finding => `${finding.path}: ${finding.message}`)
    expect(messages).toEqual(expect.arrayContaining([
      expect.stringMatching(/^api\/orders\.json#\/components\/schemas\/Order: refers to "common\.json#\/Order"/),
      expect.stringContaining('is a cookie parameter'),
      expect.stringContaining('uses style deepObject'),
      expect.stringContaining('declares the header Authorization, which Studio sets itself'),
      expect.stringContaining('Studio sends no body with GET'),
      expect.stringContaining('declares the path parameter size, which its path does not contain'),
      'studio-app.json#connections[0].operations[9]: names "missing", which api/orders.json does not define',
    ]))
    expect(checkConnectionApis(manifestWith('openapi: 3.0.3').manifest, manifestWith('openapi: 3.0.3').read).findings).toEqual([
      { path: 'api/orders.json', message: 'is not valid JSON; an app connection\'s OpenAPI document must be JSON' },
    ])
    expect(checkConnectionApis(manifestWith({ swagger: '2.0' }).manifest, manifestWith({ swagger: '2.0' }).read).findings[0]!.message).toContain('not an OpenAPI 3.0 or 3.1 document')
  })
})

describe('requests built from operations', () => {
  const api = apisOf().get('orders')!
  const build = (operation: string, params: Omit<ConnectionCallWireParams, 'connection' | 'operation'> = {}) =>
    buildHttpRequest(api.index.operations.get(operation)!, api.validators.get(operation)!, { connection: 'orders', operation, ...params })
  const violations = async (promise: Promise<unknown>) => {
    try {
      await promise
    } catch (error) {
      expect(error).toMatchObject({ code: 'invalid_request' })
      return (error as { violations: { path: string, message: string }[] }).violations.map(violation => violation.path)
    }
    throw new Error('expected a refusal')
  }

  it('fills the path template one segment per value and never leaves it', async () => {
    expect((await build('getOrder', { path: { orderId: 'a/b c?d' } })).path).toBe('/orders/a%2Fb%20c%3Fd')
    expect((await build('getOrder', { path: { orderId: 'https://attacker.example.org' } })).path).toBe('/orders/https%3A%2F%2Fattacker.example.org')
    expect(await violations(build('getOrder', { path: { orderId: '..' } }))).toEqual(['path.orderId'])
    expect(await violations(build('getOrder', {}))).toEqual(['path.orderId'])
    expect(await violations(build('getOrder', { path: { orderId: '1', other: 'x' } }))).toEqual(['path.other'])
  })

  it('sends declared query and header parameters only, coerced and checked', async () => {
    const request = await build('listOrders', { query: { asset: 'urn:x', limit: '5', status: ['open', 'done'] } })
    expect(request.query).toEqual([['asset', 'urn:x'], ['limit', '5'], ['status', 'open'], ['status', 'done']])
    expect(request.headers.Accept).toBe('application/json')
    expect(await violations(build('listOrders', { query: { limit: 500, status: 'closed', debug: true } }))).toEqual(expect.arrayContaining(['query.debug', 'query.asset', 'query.limit', 'query.status.0']))
    const put = await build('replaceOrder', { path: { orderId: '1' }, headers: { 'if-match': '"7"' }, body: { title: 'Pump' } })
    expect(put.headers).toMatchObject({ 'If-Match': '"7"', 'Content-Type': 'application/json' })
    expect(await violations(build('replaceOrder', { path: { orderId: '1' }, headers: { 'If-Match': '"7"\r\nX-Evil: 1', 'Cookie': 'a' }, body: { title: 'Pump' } }))).toEqual(['headers.Cookie', 'headers.If-Match'])
  })

  it('validates JSON bodies with the document\'s schemas, OpenAPI 3.0 converted', async () => {
    const request = await build('createOrder', { body: { title: 'Replace bearing', due: null, priority: 1 } })
    expect(request).toMatchObject({ method: 'POST', path: '/orders', body: '{"title":"Replace bearing","due":null,"priority":1}' })
    expect(await violations(build('createOrder', { body: { due: '2026-13-45', priority: 0, color: 'red' } }))).toEqual(expect.arrayContaining(['body', 'body.due', 'body.priority']))
    expect(await violations(build('createOrder', {}))).toEqual(['body'])
    expect(await violations(build('getOrder', { path: { orderId: '1' }, body: 'x' }))).toEqual(['body'])
    expect(await violations(build('createOrder', { body: 'AAAA', encoding: 'base64' }))).toEqual(['body'])
  })

  it('picks a declared media type and takes text, bytes and forms', async () => {
    expect(await build('replaceOrder', { path: { orderId: '1' }, headers: { 'If-Match': '*' }, contentType: 'text/plain', body: 'hello' })).toMatchObject({ body: 'hello', headers: { 'Content-Type': 'text/plain' } })
    expect(await violations(build('replaceOrder', { path: { orderId: '1' }, headers: { 'If-Match': '*' }, contentType: 'text/csv', body: 'a,b' }))).toEqual(['contentType'])
    const photo = await build('putPhoto', { path: { orderId: '1' }, contentType: 'image/png', body: Buffer.from([137, 80, 78, 71]).toString('base64'), encoding: 'base64' })
    expect(photo.headers['Content-Type']).toBe('image/png')
    expect([...(photo.body as Uint8Array)]).toEqual([137, 80, 78, 71])
    expect(await violations(build('putPhoto', { path: { orderId: '1' }, body: 'not bytes' }))).toEqual(['body'])
    expect(await build('search', { body: { fields: { q: 'pump & valve' } } })).toMatchObject({ body: 'q=pump+%26+valve', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } })
  })

  it('builds multipart bodies from fields and files', async () => {
    const request = await build('addAttachment', {
      path: { orderId: '1' },
      body: { fields: { note: 'front', pages: '2' }, files: { file: { fileName: 'scan "1".pdf', contentType: 'application/pdf', base64: Buffer.from('%PDF-1.7').toString('base64') } } },
    })
    const contentType = request.headers['Content-Type']!
    expect(contentType).toMatch(/^multipart\/form-data; boundary=/)
    const text = Buffer.from(request.body as Uint8Array).toString('utf8')
    expect(text).toContain('name="note"\r\n\r\nfront')
    expect(text).toContain('Content-Type: application/pdf\r\n\r\n%PDF-1.7')
    expect(await violations(build('addAttachment', { path: { orderId: '1' }, body: { fields: { note: 'far too long for the schema', pages: 'two', extra: 'x' } } })))
      .toEqual(expect.arrayContaining(['body.file', 'body.extra', 'body.fields.note', 'body.fields.pages']))
  })

  it('refuses bodies over 8 MiB', async () => {
    expect(await violations(build('replaceOrder', { path: { orderId: '1' }, headers: { 'If-Match': '*' }, contentType: 'text/plain', body: 'x'.repeat(8 * 1024 * 1024 + 1) }))).toEqual(['body'])
  })

  it('returns answers by media type, binary ones as base64', () => {
    const headers = (contentType: string) => new Headers({ 'content-type': contentType, 'etag': '"3"' })
    expect(callResult(200, headers('application/json; charset=utf-8'), Buffer.from('{"id":"1"}'))).toEqual({ status: 200, contentType: 'application/json; charset=utf-8', etag: '"3"', location: null, body: { id: '1' } })
    expect(locationBelow('http://orders:8080/api/v1', '/orders', '/api/v1/orders/7?view=full')).toBe('/orders/7?view=full')
    expect(locationBelow('http://orders:8080/api/v1/', '/orders', 'http://orders:8080/api/v1/orders/7')).toBe('/orders/7')
    expect(locationBelow('http://orders:8080/api/v1', '/orders/7/photos', '3')).toBe('/orders/7/3')
    expect(locationBelow('http://orders:8080/api/v1', '/orders', 'https://elsewhere.example.org/x')).toBeNull()
    expect(locationBelow('http://orders:8080/api/v1', '/orders', '/admin/x')).toBeNull()
    expect(locationBelow('http://orders:8080/api/v1', '/orders', null)).toBeNull()
    expect(callResult(404, headers('application/problem+json'), Buffer.from('{"title":"missing"}')).body).toEqual({ title: 'missing' })
    expect(callResult(200, headers('application/json'), Buffer.from('not json')).body).toBe('not json')
    expect(callResult(200, headers('text/csv; charset=iso-8859-1'), Buffer.from([0x47, 0x72, 0xFC, 0xDF])).body).toBe('Grüß')
    expect(callResult(200, headers('image/png'), new Uint8Array([1, 2, 3]))).toMatchObject({ body: 'AQID', encoding: 'base64' })
    expect(callResult(204, new Headers(), new Uint8Array()).body).toBeNull()
  })
})

describe('bytes in the HTTP binding', () => {
  it('encodes the app\'s Uint8Arrays as base64 and decodes binary answers', () => {
    const encoded = encodeConnectionCall({ connection: 'orders', operation: 'putPhoto', body: new Uint8Array([1, 2, 3]) })
    expect(encoded).toEqual({ connection: 'orders', operation: 'putPhoto', body: 'AQID', encoding: 'base64' })
    expect(connectionCallParamsSchema.safeParse(encoded).success).toBe(true)
    expect(encodeConnectionCall({ connection: 'orders', operation: 'addAttachment', body: { fields: { a: 'b' }, files: { file: { fileName: 'a.bin', bytes: new Uint8Array([255]) } } } }))
      .toEqual({ connection: 'orders', operation: 'addAttachment', body: { fields: { a: 'b' }, files: { file: { fileName: 'a.bin', base64: '/w==' } } } })
    const json = { connection: 'orders', operation: 'createOrder', body: { title: 'x' } }
    expect(encodeConnectionCall(json)).toBe(json)
    const { result, transfer } = decodeConnectionResult({ status: 200, contentType: 'image/png', etag: null, location: null, body: 'AQID', encoding: 'base64' })
    expect(result).toEqual({ status: 200, contentType: 'image/png', etag: null, location: null, body: new Uint8Array([1, 2, 3]) })
    expect(transfer).toHaveLength(1)
  })
})

describe('http connections in infrastructures', () => {
  const base = { key: 'orders', type: 'http', url: 'https://orders.example.org/api', auth: { scheme: 'none' } }

  it('bind app connections and refuse aliases', () => {
    expect(connectionInputSchema.parse({ ...base, apps: [{ app: 'org.example.orders', connection: 'orders' }] })).toMatchObject({ settings: {}, aliases: [], apps: [{ app: 'org.example.orders', connection: 'orders' }] })
    expect(connectionInputSchema.safeParse({ ...base, aliases: ['https://other.example.org'] }).success).toBe(false)
    expect(connectionInputSchema.safeParse({ ...base, apps: [{ app: 'Not An App', connection: 'orders' }] }).success).toBe(false)
  })

  it('bind an app connection at most once per infrastructure', () => {
    const input = (connections: unknown[]) => ({ name: 'Plant', template: 'mono-all', endpoints: [{ type: 'aasEnvironment', url: 'https://aas.example.org' }], security: { mode: 'unsecured' }, connections })
    const binding = { app: 'org.example.orders', connection: 'orders' }
    expect(infrastructureInputSchema.safeParse(input([{ ...base, apps: [binding] }, { ...base, key: 'other', apps: [{ ...binding, connection: 'other' }] }])).success).toBe(true)
    const twice = infrastructureInputSchema.safeParse(input([{ ...base, apps: [binding] }, { ...base, key: 'other', apps: [binding] }]))
    expect(twice.success).toBe(false)
    expect(twice.error?.issues[0]?.path).toEqual(['connections', 1, 'apps', 0])
  })
})

describe('calls through http connections', () => {
  let handle: DatabaseHandle
  let deps: StudioDeps
  let broker: CredentialBroker
  const sessionId = 'session-1'
  const actor = { subject: 'alice', name: 'Alice', roles: [], isAdmin: false, sessionId } as Actor
  const apis = apisOf()
  const { manifest } = manifestWith(orders)
  const installation = { id: 'app-0123456789abcdef', appId: manifest.id, manifest }

  interface Recorded { path: string, method: string, headers: Record<string, string | string[] | undefined>, body: Buffer }
  let answer: (request: Recorded) => { status?: number, headers?: Record<string, string>, body?: string | Uint8Array } = () => ({ body: '[]' })
  const requests: Recorded[] = []
  let service: { base: string, close: () => Promise<unknown> }
  let idp: { base: string, close: () => Promise<unknown> }

  async function serve (handler: (request: Recorded, base: string) => { status?: number, headers?: Record<string, string>, body?: string | Uint8Array }, record = true) {
    const server = createServer((req, res) => {
      const chunks: Buffer[] = []
      req.on('data', chunk => chunks.push(chunk as Buffer))
      req.on('end', () => {
        const recorded = { path: req.url!, method: req.method!, headers: req.headers, body: Buffer.concat(chunks) }
        if (record) {
          requests.push(recorded)
        }
        const reply = handler(recorded, url)
        res.writeHead(reply.status ?? 200, { 'Content-Type': 'application/json', ...reply.headers })
        res.end(reply.body ?? '')
      })
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    return { base: url, close: () => new Promise(resolve => server.close(resolve)) }
  }

  beforeAll(async () => {
    handle = await openDatabase({ kind: 'memory' })
    await applyMigrations(handle.db, await loadMigrationsFromDirectory(migrationsDirectory))
    service = await serve(request => answer(request))
    idp = await serve((request, base) => {
      if (request.path === '/.well-known/openid-configuration') {
        return { body: JSON.stringify({ issuer: base, token_endpoint: `${base}/token`, authorization_endpoint: `${base}/auth`, jwks_uri: `${base}/jwks`, response_types_supported: ['code'] }) }
      }
      const form = new URLSearchParams(request.body.toString())
      return { body: JSON.stringify({ access_token: `exchanged-for-${form.get('audience')}`, issued_token_type: 'urn:ietf:params:oauth:token-type:access_token', token_type: 'Bearer', expires_in: 300 }) }
    }, false)
  })

  beforeEach(async () => {
    requests.length = 0
    answer = () => ({ body: '[]' })
    forgetOidcClients()
    await handle.db.delete(infrastructures)
    await handle.db.delete(studioSessions)
    await handle.db.delete(auditEvents)
    const config = loadStudioConfig({
      STUDIO_PUBLIC_URL: 'https://studio.example.org',
      STUDIO_DATA_KEY: randomBytes(32).toString('base64url'),
      STUDIO_OIDC_ISSUER: 'https://idp.example.org/realms/x',
      STUDIO_OIDC_CLIENT_ID: 'studio',
      STUDIO_PRIVATE_NETWORK_TARGETS: 'allow',
    }, 'hosted')
    deps = { config, db: handle.db, cipher: new SecretCipher(config.dataKey) }
    broker = new CredentialBroker(deps)
    await handle.db.insert(studioSessions).values({ id: sessionId, subject: 'alice', displayName: 'Alice', roles: [], csrfToken: 'c' })
    process.env.HTTP_TEST_ORDERS_TOKEN = 'orders-secret'
  })

  afterAll(async () => {
    delete process.env.HTTP_TEST_ORDERS_TOKEN
    await service.close()
    await idp.close()
    await handle.close()
  })

  const ordersConnection = (overrides: Partial<Extract<Connection, { type: 'http' }>> = {}): Connection => ({
    key: 'work-orders',
    type: 'http',
    url: `${service.base}/api/v1`,
    aliases: [],
    allowPrivateNetwork: true,
    auth: { scheme: 'bearer', token: { kind: 'env', ref: 'HTTP_TEST_ORDERS_TOKEN' } },
    settings: {},
    apps: [{ app: 'org.example.orders', connection: 'orders' }],
    ...overrides,
  })

  const unsecured: InfrastructureRecord['security'] = { mode: 'unsecured' }

  async function insert (connections: Connection[], security = unsecured): Promise<InfrastructureRecord> {
    const [record] = await handle.db.insert(infrastructures).values({
      id: 'plant',
      name: 'Plant',
      template: 'mono-all',
      endpoints: [{ type: 'aasEnvironment', url: 'http://127.0.0.1:1' }],
      security,
      connections,
      allowPrivateNetwork: true,
      createdBy: 'test',
    }).returning()
    return record!
  }

  const call = (record: InfrastructureRecord | null, params: Omit<ConnectionCallWireParams, 'connection'> & { connection?: string }, limiter = new CallLimiter()) =>
    callHttpConnection(deps, broker, limiter, { actor, installation, apis, record, caller: 'host', requestId: 'r1', params: { connection: 'orders', ...params } } satisfies HttpCall)

  const audits = async () => (await handle.db.select().from(auditEvents)).map(audit => ({ action: audit.action, outcome: audit.outcome, ...audit.details }))

  it('sends a declared operation to the connection\'s URL with its token, and returns the answer', async () => {
    const record = await insert([ordersConnection()])
    answer = () => ({ status: 201, headers: { ETag: '"1"', Location: '/api/v1/orders/1' }, body: '{"id":"1","title":"Pump"}' })
    const result = await call(record, { operation: 'createOrder', body: { title: 'Pump' } })
    // The location relative to the connection's URL, as the operations' paths are.
    expect(result).toEqual({ status: 201, contentType: 'application/json', etag: '"1"', location: '/orders/1', body: { id: '1', title: 'Pump' } })
    expect(requests).toHaveLength(1)
    expect(requests[0]).toMatchObject({ method: 'POST', path: '/api/v1/orders', headers: { 'authorization': 'Bearer orders-secret', 'content-type': 'application/json', 'accept': 'application/json' } })
    expect(JSON.stringify(result)).not.toContain('orders-secret')
    const [audit] = await audits()
    expect(audit).toMatchObject({ action: 'connection.call', outcome: 'success', appId: 'org.example.orders', appConnection: 'orders', connection: 'work-orders', operation: 'createOrder', method: 'POST', status: 201, caller: 'host' })
    expect(JSON.stringify(await handle.db.select().from(auditEvents))).not.toMatch(/orders-secret|Pump/)
  })

  it('returns answers that are not 2xx as results, binary ones as base64', async () => {
    const record = await insert([ordersConnection()])
    answer = () => ({ status: 404, headers: { 'Content-Type': 'application/problem+json' }, body: '{"title":"No such order"}' })
    expect(await call(record, { operation: 'getOrder', path: { orderId: '9' } })).toMatchObject({ status: 404, body: { title: 'No such order' } })
    answer = () => ({ headers: { 'Content-Type': 'image/png' }, body: new Uint8Array([137, 80, 78, 71]) })
    expect(await call(record, { operation: 'getPhoto', path: { orderId: '9' } })).toMatchObject({ status: 200, contentType: 'image/png', body: 'iVBORw==', encoding: 'base64' })
    answer = () => ({ status: 304, headers: { ETag: '"2"' } })
    expect(await call(record, { operation: 'getOrder', path: { orderId: '9' } })).toMatchObject({ status: 304, etag: '"2"', body: null })
  })

  it('refuses redirects, and audits it', async () => {
    const record = await insert([ordersConnection()])
    answer = () => ({ status: 302, headers: { Location: 'https://attacker.example.org/collect' } })
    await expect(call(record, { operation: 'getOrder', path: { orderId: '1' } })).rejects.toMatchObject({ code: 'connection_request_refused' })
    await expect(call(record, { operation: 'getOrder', path: { orderId: '1' } })).rejects.not.toMatchObject({ detail: expect.stringContaining('attacker') })
    expect((await audits())[0]).toMatchObject({ outcome: 'failure', code: 'connection_request_refused', operation: 'getOrder' })
  })

  it('refuses unbound apps, undeclared operations and invalid calls before sending anything, and audits each', async () => {
    const unbound = await insert([ordersConnection({ apps: [{ app: 'org.example.other', connection: 'orders' }] })])
    await expect(call(unbound, { operation: 'listOrders', query: { asset: 'x' } })).rejects.toMatchObject({ code: 'connection_not_bound' })
    await expect(call(null, { operation: 'listOrders', query: { asset: 'x' } })).rejects.toMatchObject({ code: 'connection_not_bound' })
    await handle.db.delete(infrastructures)
    const record = await insert([ordersConnection()])
    await expect(call(record, { operation: 'notListed' })).rejects.toMatchObject({ code: 'connection_operation_not_declared' })
    await expect(call(record, { connection: 'billing', operation: 'listOrders' })).rejects.toMatchObject({ code: 'connection_operation_not_declared' })
    await expect(call(record, { operation: 'createOrder', body: { name: 'no title' } })).rejects.toMatchObject({ code: 'invalid_request' })
    expect(requests).toHaveLength(0)
    expect((await audits()).map(audit => [audit.outcome, audit.code])).toEqual([
      ['failure', 'connection_not_bound'],
      ['failure', 'connection_not_bound'],
      ['failure', 'connection_operation_not_declared'],
      ['failure', 'connection_operation_not_declared'],
      ['failure', 'invalid_request'],
    ])
  })

  it('allows four calls per session and connection at a time', async () => {
    const record = await insert([ordersConnection()])
    const limiter = new CallLimiter()
    const taken = Array.from({ length: 4 }, () => limiter.acquire(`${sessionId} plant work-orders`))
    expect(taken.every(Boolean)).toBe(true)
    expect(limiter.acquire(`${sessionId} plant work-orders`)).toBeNull()
    await expect(call(record, { operation: 'listOrders', query: { asset: 'x' } }, limiter)).rejects.toMatchObject({ code: 'connection_busy' })
    taken[0]!()
    taken[0]!()
    expect(await call(record, { operation: 'listOrders', query: { asset: 'x' } }, limiter)).toMatchObject({ status: 200 })
    expect(limiter.acquire(`${sessionId} plant work-orders`)).not.toBeNull()
  })

  it('passes the signed-in user\'s identity by token exchange, and needs the user to have opened the infrastructure', async () => {
    const security: InfrastructureRecord['security'] = { mode: 'delegated_user', issuer: idp.base, clientId: 'studio-web', scopes: ['openid'], clientSecret: null, desktopLoopbackHost: '127.0.0.1' }
    const record = await insert([ordersConnection({ auth: { scheme: 'delegatedUser', audience: 'work-orders', scopes: [], forwardUserToken: false } })], security)
    await expect(call(record, { operation: 'listOrders', query: { asset: 'x' } })).rejects.toMatchObject({ code: 'target_auth_required' })
    const userToken = ['{"alg":"none"}', JSON.stringify({ sub: 'alice', aud: ['account'] })].map(part => Buffer.from(part).toString('base64url')).join('.') + '.signature'
    await handle.db.insert(targetCredentials).values({
      sessionId,
      targetId: record.id,
      accessTokenCiphertext: deps.cipher.encrypt(userToken, 'target_credentials.access_token'),
      accessTokenExpiresAt: new Date(Date.now() + 600_000),
      subject: 'alice',
    })
    expect(await call(record, { operation: 'listOrders', query: { asset: 'x' } })).toMatchObject({ status: 200 })
    expect(requests[0]!.headers.authorization).toBe('Bearer exchanged-for-work-orders')
    expect((await audits()).at(-1)).toMatchObject({ outcome: 'success', delegation: 'exchanged' })

    // The user's token is not issued for the service, so it is not forwarded.
    await handle.db.update(infrastructures).set({ connections: [ordersConnection({ auth: { scheme: 'delegatedUser', audience: 'work-orders', scopes: [], forwardUserToken: true } })] })
    const forwarding = { ...record, connections: [ordersConnection({ auth: { scheme: 'delegatedUser', audience: 'work-orders', scopes: [], forwardUserToken: true } })] }
    await expect(call(forwarding, { operation: 'listOrders', query: { asset: 'x' } })).rejects.toMatchObject({ code: 'connection_request_refused' })
    expect(requests).toHaveLength(1)
  })

  it('tests an http connection: the credentials and an answer from its URL', async () => {
    const record = await insert([ordersConnection()])
    answer = () => ({ status: 404 })
    const result = await testConnection(deps, broker, record, 'work-orders', { ...actor, isAdmin: true }, 'r1')
    expect(result.checks.map(check => [check.check, check.ok, check.status])).toEqual([['token', true, null], ['health', true, 404]])
    answer = () => ({ status: 401 })
    expect((await testConnection(deps, broker, record, 'work-orders', { ...actor, isAdmin: true }, 'r2')).ok).toBe(false)
    expect(requests.map(request => [request.method, request.path])).toEqual([['GET', '/api/v1'], ['GET', '/api/v1']])
  })
})
