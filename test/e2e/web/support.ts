import type { APIRequestContext, Page } from '@playwright/test'
import { expect } from '@playwright/test'

export const openTargetUrl = 'http://localhost:18081'
export const securedTargetUrl = 'http://localhost:18082'
export const edgeCasesShell = 'urn:studio:test:aas:edge-cases'
export const edgeCasesSubmodel = 'urn:studio:test:sm:edge-cases'

export function key (value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url')
}

/** Signs in through the test realm (users' passwords equal their names). */
export async function signIn (page: Page, username: string): Promise<void> {
  await page.goto('/')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.locator('#username').fill(username)
  await page.locator('#password').fill(username)
  await page.locator('#kc-login').click()
  await expect(page.getByRole('heading', { name: 'AAS targets' })).toBeVisible()
}

/** Calls the Studio API with the page's session, as the UI does. */
export async function studioApi (page: Page) {
  const request: APIRequestContext = page.request
  const baseURL = new URL(page.url()).origin
  const session = await (await request.get('/api/studio/v1/session')).json() as { csrfToken: string }
  const headers = { 'Origin': baseURL, 'X-CSRF-Token': session.csrfToken }
  return {
    get: (path: string) => request.get(`/api/studio/v1${path}`),
    post: (path: string, data: unknown) => request.post(`/api/studio/v1${path}`, { headers, data }),
    delete: (path: string) => request.delete(`/api/studio/v1${path}`, { headers }),
  }
}

/** Registers a target, replacing one with the same name left over from an earlier run. */
async function registerTarget (page: Page, name: string, url: string, security: unknown): Promise<string> {
  const api = await studioApi(page)
  const existing = await (await api.get('/infrastructures')).json() as { items: Array<{ id: string, name: string }> }
  for (const item of existing.items.filter(item => item.name === name)) {
    await api.delete(`/infrastructures/${item.id}`)
  }
  const response = await api.post('/infrastructures', {
    name,
    endpoints: [{ type: 'aasRepository', url }, { type: 'submodelRepository', url }],
    security,
    allowPrivateNetwork: true,
  })
  expect(response.status(), await response.text()).toBe(201)
  return (await response.json() as { id: string }).id
}

export function registerOpenTarget (page: Page, name: string): Promise<string> {
  return registerTarget(page, name, openTargetUrl, { mode: 'unsecured' })
}

/** The secured target, accessed with Studio's service account (client credentials). */
export function registerSecuredServiceTarget (page: Page, name: string): Promise<string> {
  return registerTarget(page, name, securedTargetUrl, {
    mode: 'deployment_client_credentials',
    issuer: 'http://keycloak.localhost:18080/realms/basyx-studio',
    clientId: 'studio-service',
    scopes: ['basyx-api'],
    clientSecret: { ref: 'env:STUDIO_TESTENV_SERVICE_SECRET' },
  })
}

/** Sets a property value directly at BaSyx, as another client would. */
export async function setAtSource (request: APIRequestContext, submodelId: string, path: string, value: string): Promise<void> {
  const response = await request.patch(`${openTargetUrl}/submodels/${key(submodelId)}/submodel-elements/${path}/$value`, { data: JSON.stringify(value), headers: { 'Content-Type': 'application/json' } })
  expect(response.status()).toBe(204)
}
