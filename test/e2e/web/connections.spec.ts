import type { FrameLocator, Page, Request } from '@playwright/test'
import type { ChildProcess } from 'node:child_process'
import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'
import { installApp, openTargetUrl, signIn, studioApi, uninstallAllApps } from './support'

// HTTP connections for apps (ADR 0047, MVP-7 phase E): the work-orders
// example calls its mock service through Studio with a static token and with
// the signed-in user's identity (token exchange). Unbound apps, undeclared
// operations and invalid bodies are refused, and no token or service URL
// reaches the browser. Run `pnpm apps:build` first.

test.describe.configure({ mode: 'serial' })

const root = fileURLToPath(new URL('../../..', import.meta.url))
const issuer = process.env.STUDIO_E2E_ISSUER ?? 'http://keycloak.localhost:18080/realms/basyx-studio'
const clientId = process.env.STUDIO_E2E_CLIENT_ID ?? 'studio-web'
/** The secret the Studio Service reads as env:STUDIO_E2E_WORK_ORDERS_TOKEN (web.config.ts). */
const staticToken = 'e2e-work-orders-token'
const servicePort = 18_591
const serviceUrl = `http://127.0.0.1:${servicePort}/api/v1`
const appId = 'org.eclipse.basyx.examples.work-orders'

let service: ChildProcess
let installationId: string

test.beforeAll(async () => {
  service = spawn(process.execPath, [join(root, 'examples/apps/work-orders/service/server.mjs')], {
    env: { ...process.env, PORT: String(servicePort), SERVICE_TOKEN: staticToken, OIDC_ISSUER: issuer, SERVICE_AUDIENCE: 'work-orders' },
    stdio: 'ignore',
  })
  await expect.poll(() => fetch(serviceUrl).then(response => response.status, () => 0), { timeout: 15_000 }).toBe(200)
})

test.afterAll(() => {
  service.kill()
})

test.beforeEach(async ({ page }) => {
  await signIn(page, 'studio-admin')
  await uninstallAllApps(page)
  installationId = await installApp(page, new Uint8Array(await readFile(join(root, 'examples/apps/dist/work-orders.zip'))))
})

/** Registers the open BaSyx server with an http connection to the mock service, replacing a leftover of the same name. */
async function registerWithService (page: Page, name: string, security: unknown, auth: unknown, bound = true): Promise<string> {
  const api = await studioApi(page)
  const existing = await (await api.get('/infrastructures')).json() as { items: Array<{ id: string, name: string }> }
  for (const item of existing.items.filter(item => item.name === name)) {
    await api.delete(`/infrastructures/${item.id}`)
  }
  const response = await api.post('/infrastructures', {
    name,
    template: 'full',
    endpoints: [{ type: 'aasRepository', url: openTargetUrl }, { type: 'submodelRepository', url: openTargetUrl }],
    listSource: 'repository',
    security,
    allowPrivateNetwork: true,
    connections: [{
      key: 'work-orders',
      type: 'http',
      url: serviceUrl,
      auth,
      allowPrivateNetwork: true,
      apps: bound ? [{ app: appId, connection: 'orders' }] : [],
    }],
  })
  expect(response.status(), await response.text()).toBe(201)
  return (await response.json() as { id: string }).id
}

function moduleFrame (page: Page): FrameLocator {
  return page.frameLocator('iframe[title="App: Work orders"]')
}

/** Every request of the page and its frames, with headers and body. */
function recordRequests (page: Page): Request[] {
  const requests: Request[] = []
  page.on('request', request => requests.push(request))
  return requests
}

async function expectNoSecretIn (requests: Request[], secrets: string[]) {
  expect(requests.some(request => request.url().endsWith('/api/studio/v1/app-calls'))).toBe(true)
  for (const request of requests) {
    expect(new URL(request.url()).port, request.url()).not.toBe(String(servicePort))
    const sent = JSON.stringify({ url: request.url(), headers: await request.allHeaders(), body: request.postData() })
    for (const secret of secrets) {
      expect(sent).not.toContain(secret)
    }
  }
}

test('calls the service with a static token that never reaches the browser', async ({ page }) => {
  const targetId = await registerWithService(page, 'E2E connections (static token)', { mode: 'unsecured' }, { scheme: 'bearer', token: { ref: 'env:STUDIO_E2E_WORK_ORDERS_TOKEN' } })
  const requests = recordRequests(page)
  await page.goto(`/targets/${targetId}/apps/${installationId}/work-orders`)
  const frame = moduleFrame(page)
  await expect(frame.locator('[data-test="caller"]')).toContainText('static token (token)')

  const title = `Replace bearing ${Date.now()}`
  await frame.getByRole('textbox', { name: 'Title' }).fill(title)
  await frame.getByRole('button', { name: 'Create' }).click()
  const order = frame.locator('[data-test="orders"] .v-list-item', { hasText: title })
  await expect(order).toBeVisible()
  // Read for its ETag, then changed with If-Match.
  await order.getByRole('button', { name: 'Done' }).click()
  await expect(order).toContainText('done')

  await expectNoSecretIn(requests, [staticToken, serviceUrl])
})

test('passes the signed-in user\'s identity by token exchange', async ({ page }) => {
  const targetId = await registerWithService(
    page,
    'E2E connections (signed in)',
    { mode: 'delegated_user', issuer, clientId, scopes: ['openid'], clientSecret: { ref: 'env:STUDIO_OIDC_CLIENT_SECRET' } },
    { scheme: 'delegatedUser', audience: 'work-orders', scopes: ['work-orders'] },
  )
  // Opening the target starts its authorization; the IdP session signs in right away.
  await page.goto(`/targets/${targetId}/shells`)
  await expect(page.getByText('EdgeCasesShell').first()).toBeVisible()
  const requests = recordRequests(page)
  await page.goto(`/targets/${targetId}/apps/${installationId}/work-orders`)
  await expect(moduleFrame(page).locator('[data-test="caller"]')).toContainText('studio-admin (user)')
  await expectNoSecretIn(requests, [serviceUrl])
})

test('refuses unbound apps, undeclared operations and invalid bodies, and keeps path values on the service', async ({ page }) => {
  const unbound = await registerWithService(page, 'E2E connections (unbound)', { mode: 'unsecured' }, { scheme: 'bearer', token: { ref: 'env:STUDIO_E2E_WORK_ORDERS_TOKEN' } }, false)
  await page.goto(`/targets/${unbound}/apps/${installationId}/work-orders`)
  await expect(moduleFrame(page).locator('[data-test="error"]')).toContainText('connection_not_bound')

  const bound = await registerWithService(page, 'E2E connections (static token)', { mode: 'unsecured' }, { scheme: 'bearer', token: { ref: 'env:STUDIO_E2E_WORK_ORDERS_TOKEN' } })
  const api = await studioApi(page)
  const call = (params: Record<string, unknown>) => api.post('/app-calls', { installationId, targetId: bound, method: 'studio.connections.call', params: { connection: 'orders', ...params } })

  const undeclared = await call({ operation: 'deleteAllOrders' })
  expect([undeclared.status(), (await undeclared.json()).code]).toEqual([403, 'connection_operation_not_declared'])
  const invalid = await call({ operation: 'createOrder', body: { title: '' } })
  expect(invalid.status()).toBe(400)
  expect((await invalid.json()).violations.map((violation: { path: string }) => violation.path)).toEqual(expect.arrayContaining(['body', 'body.title']))
  // A URL is no order ID: the operation's schema refuses it before anything is sent.
  const foreign = await call({ operation: 'getOrder', path: { orderId: 'https://attacker.example.org' } })
  expect(foreign.status()).toBe(400)
  const missing = await call({ operation: 'getOrder', path: { orderId: '999999' } })
  expect((await missing.json()).result).toMatchObject({ status: 404, contentType: 'application/problem+json', body: { title: 'No such order' } })
})
