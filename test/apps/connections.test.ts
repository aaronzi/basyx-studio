import type { AppManifest } from '@basyx/studio-sdk/protocol'
import type { StudioConfig } from '~~/server/lib/config'
import type { DatabaseHandle } from '~~/server/lib/database/client'
import type { Actor, StudioDeps } from '~~/server/lib/deps'
import { randomBytes } from 'node:crypto'
import { checkPackage } from '@basyx/studio-app-kit/package'
import manifestSchema from '@basyx/studio-sdk/app-manifest.schema.json' with { type: 'json' }
import { connectionIdPattern, connectionIdRule } from '@basyx/studio-sdk/protocol'
import { connectionsHandler, createTestStudio } from '@basyx/studio-sdk/testing'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { authorizeAppCall } from '~~/server/lib/apps/calls'
import { readAppPackage } from '~~/server/lib/apps/package'
import { describeInstallation, inspectAppPackage, installApp } from '~~/server/lib/apps/store'
import { emptyTrustStore } from '~~/server/lib/apps/trust'
import { SecretCipher } from '~~/server/lib/crypto/cipher'
import { openDatabase } from '~~/server/lib/database/client'
import { applyMigrations, loadMigrationsFromDirectory } from '~~/server/lib/database/migrate'
import { StudioProblem } from '~~/server/lib/problem'
import { connectionBindingSchema, connectionCallParamsSchema } from '#shared/contract'
import { manifestOf, zipApp } from './support'

// App connections in packages, consent and calls (ADR 0047).

const migrationsDirectory = new URL('../../server/database/migrations', import.meta.url).pathname
const admin: Actor = { subject: 'studio-admin', name: 'Admin', roles: ['studio-admin'], isAdmin: true, sessionId: 's1' }

function api (paths: Record<string, unknown>) {
  return JSON.stringify({ openapi: '3.1.0', info: { title: 'Weather', version: '1' }, paths })
}

const forecastPath = { get: { operationId: 'getForecast', summary: 'Forecast of a station', parameters: [{ name: 'station', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'ok' } } } }

function withConnections (overrides: Partial<AppManifest> = {}, operations = ['getForecast']): AppManifest {
  return manifestOf({
    studioApi: '^0.1.6',
    permissions: ['studio.aas.read', 'studio.connections'],
    connections: [{ id: 'weather', title: { en: 'Weather' }, api: 'api/weather.json', operations }],
    ...overrides,
  })
}

function packageOf (manifest: AppManifest, document = api({ '/stations/{station}/forecast': forecastPath })): Uint8Array {
  return zipApp(manifest, { 'ui/index.html': '<!doctype html><title>x</title>', 'api/weather.json': document })
}

function findings (bytes: Uint8Array): string[] {
  return checkPackage(bytes).findings.map(finding => `${finding.path}: ${finding.message}`)
}

describe('connections in packages', () => {
  it('pass studio-app pack and Studio\'s upload with their documents', () => {
    const bytes = packageOf(withConnections())
    expect(findings(bytes)).toEqual([])
    expect(readAppPackage(bytes, 'hosted').connections).toEqual([{
      id: 'weather',
      title: { en: 'Weather' },
      description: null,
      operations: [{ operationId: 'getForecast', method: 'GET', path: '/stations/{station}/forecast', summary: 'Forecast of a station' }],
    }])
  })

  it('need the permission, the document and Studio app API 0.1.6', () => {
    expect(findings(packageOf(withConnections({ permissions: ['studio.aas.read'] })))).toEqual(['studio-app.json#permissions: must include studio.connections when the app declares connections'])
    expect(findings(packageOf(manifestOf({ permissions: ['studio.connections'] })))).toEqual(['studio-app.json#permissions: requests studio.connections, but the app declares no connections'])
    expect(findings(packageOf(withConnections({ studioApi: '^0.1.3' })))).toEqual(['studio-app.json#studioApi: allows Studio app API 0.1.3, but connections needs 0.1.6; declare ^0.1.6'])
    expect(findings(zipApp(withConnections(), { 'ui/index.html': 'x' }))).toEqual(['studio-app.json#connections[0].api: names "api/weather.json", which is not in the package'])
    expect(findings(packageOf(withConnections({}, ['getForecast', 'getAlerts'])))).toEqual(['studio-app.json#connections[0].operations[1]: names "getAlerts", which api/weather.json does not define'])
    expect(() => readAppPackage(packageOf(withConnections(), '{"openapi":"3.1.0","paths":{"/x":{"get":{"operationId":"getForecast","parameters":[{"name":"c","in":"cookie"}]}}}}'), 'hosted'))
      .toThrow(expect.objectContaining({ code: 'app_package_rejected' }))
  })

  it('need an ID that the administrator can bind, in every check', () => {
    const camelCase = packageOf(withConnections({ connections: [{ id: 'weatherApi', title: { en: 'Weather' }, api: 'api/weather.json', operations: ['getForecast'] }] }))
    expect(findings(camelCase)).toEqual([`studio-app.json#connections.0.id: must be ${connectionIdRule}, such as weather-api: the administrator's binding and studio.connections.call name the connection by this ID`])
    expect(() => readAppPackage(camelCase, 'hosted')).toThrow(expect.objectContaining({ code: 'app_package_rejected' }))
    // app-manifest.schema.json repeats the SDK's rule for editors.
    expect(manifestSchema.$defs.connection.properties.id.pattern).toBe(connectionIdPattern.source)
    for (const id of ['weather-api', 'weatherApi', 'weather_api', '-weather', 'w'.repeat(64)]) {
      const binding = connectionBindingSchema.safeParse({ app: 'org.example.weather', connection: id }).success
      expect(connectionCallParamsSchema.safeParse({ connection: id, operation: 'getForecast' }).success).toBe(binding)
      expect(findings(packageOf(withConnections({ connections: [{ id, title: { en: 'Weather' }, api: 'api/weather.json', operations: ['getForecast'] }] }))).length === 0).toBe(binding)
    }
  })
})

describe('connections in consent and on the Apps page', () => {
  let handle: DatabaseHandle
  let deps: StudioDeps

  beforeAll(async () => {
    handle = await openDatabase({ kind: 'memory' })
    await applyMigrations(handle.db, await loadMigrationsFromDirectory(migrationsDirectory))
    const config = {
      deploymentMode: 'hosted',
      publicUrl: 'http://localhost:3000',
      adminRole: 'studio-admin',
      deployment: { appInstalls: true },
      apps: { baseUrl: 'http://apps.localhost:3000/app/', allowUnsigned: true, trustStore: emptyTrustStore, packages: [], denoPath: null, capabilityUrl: 'http://127.0.0.1:3000', workDir: '/tmp' },
    } as unknown as StudioConfig
    deps = { config, db: handle.db, cipher: new SecretCipher(randomBytes(32)) }
  })

  afterAll(async () => {
    await handle.close()
  })

  it('lists the operations, and marks those an update adds or moves', async () => {
    const first = packageOf(withConnections({ id: 'org.example.weather', version: '1.0.0' }))
    expect((await inspectAppPackage(deps, first, null)).connections[0]!.operations.map(operation => `${operation.method} ${operation.path}`)).toEqual(['GET /stations/{station}/forecast'])
    const { record } = await installApp(deps, admin, first, null, 'r1')
    expect((await describeInstallation(deps, record)).connections[0]!.operations).toHaveLength(1)

    const moved = { get: { ...forecastPath.get, parameters: forecastPath.get.parameters } }
    const alerts = { get: { operationId: 'getAlerts', responses: { 200: { description: 'ok' } } } }
    const second = packageOf(withConnections({ id: 'org.example.weather', version: '1.1.0' }, ['getForecast', 'getAlerts']), api({ '/v2/stations/{station}/forecast': moved, '/alerts': alerts }))
    const inspection = await inspectAppPackage(deps, second, null)
    expect(inspection.update).toMatchObject({
      permissionsAdded: [],
      operationsAdded: [{ connection: 'weather', operationId: 'getForecast' }, { connection: 'weather', operationId: 'getAlerts' }],
      operationsRemoved: [{ connection: 'weather', operationId: 'getForecast' }],
    })
  })
})

describe('who may call studio.connections.call', () => {
  const installation = (manifest: AppManifest) => ({ id: 'app-0123456789abcdef', appId: manifest.id, bundled: false, trust: 'unsigned', keyFingerprint: null, manifest }) as never
  const refusal = (fn: () => void) => {
    try {
      fn()
    } catch (error) {
      return error instanceof StudioProblem ? error.code : 'other'
    }
    return null
  }

  it('installed apps that declare the permission, from frames and backends', () => {
    const declared = installation(withConnections())
    expect(refusal(() => authorizeAppCall(declared, 'studio.connections.call', 'host', emptyTrustStore))).toBeNull()
    expect(refusal(() => authorizeAppCall(declared, 'studio.connections.call', 'backend', emptyTrustStore))).toBeNull()
    expect(refusal(() => authorizeAppCall(declared, 'studio.ui.notify', 'backend', emptyTrustStore))).toBe('unsupported_operation')
    expect(refusal(() => authorizeAppCall(installation(manifestOf()), 'studio.connections.call', 'host', emptyTrustStore))).toBe('app_permission_not_declared')
  })
})

describe('connections on the test Studio', () => {
  it('answer with test services per connection and operation, and refuse others as Studio does', async () => {
    const studio = createTestStudio({
      permissions: ['studio.connections'],
      handlers: {
        'studio.connections.call': connectionsHandler({
          weather: {
            getForecast: ({ path }) => ({ body: { station: path?.station, days: [] }, etag: '"1"' }),
            getRadar: () => ({ body: new Uint8Array([1, 2]) }),
          },
        }),
      },
    })
    expect(await studio.client.connections.call({ connection: 'weather', operation: 'getForecast', path: { station: 'berlin' } }))
      .toEqual({ status: 200, contentType: 'application/json', etag: '"1"', location: null, body: { station: 'berlin', days: [] } })
    expect(await studio.client.connections.call({ connection: 'weather', operation: 'getRadar' })).toMatchObject({ contentType: 'application/octet-stream', body: new Uint8Array([1, 2]) })
    await expect(studio.client.connections.call({ connection: 'weather', operation: 'getAlerts' })).rejects.toMatchObject({ code: 'connection_operation_not_declared', problem: { status: 403 } })
    await expect(studio.client.connections.call({ connection: 'billing', operation: 'getForecast' })).rejects.toMatchObject({ code: 'connection_not_bound' })
  })
})
