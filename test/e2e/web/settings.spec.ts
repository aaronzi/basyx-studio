import type { FrameLocator, Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'
import { installApp, openTargetUrl, signIn, studioApi, uninstallAllApps } from './support'

// Declared app settings and connection status (ADR 0048, phase D of the
// external apps follow-up plan): one package of the asset-board example runs
// on two infrastructures with different asset types, set through the API
// and in the infrastructure dialog, with an installation value from the
// Apps page; values of the wrong type are refused. The work-orders example
// shows that its connection is not bound before it calls
// (connections.spec.ts). Run `pnpm apps:build` first.

test.describe.configure({ mode: 'serial' })

const root = fileURLToPath(new URL('../../..', import.meta.url))
const appId = 'org.eclipse.basyx.examples.asset-board'

let installationId: string

test.beforeEach(async ({ page }) => {
  await signIn(page, 'studio-admin')
  await uninstallAllApps(page)
  installationId = await installApp(page, new Uint8Array(await readFile(join(root, 'examples/apps/dist/asset-board.zip'))))
})

/** Registers the open BaSyx server with the app's settings, replacing a leftover of the same name. */
async function register (page: Page, name: string, apps: unknown[]): Promise<string> {
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
    security: { mode: 'unsecured' },
    allowPrivateNetwork: true,
    apps,
  })
  expect(response.status(), await response.text()).toBe(201)
  return (await response.json() as { id: string }).id
}

function board (page: Page): FrameLocator {
  return page.frameLocator('iframe[title="App: Asset board"]')
}

test('runs one package on two infrastructures with their own asset types, set by API, dialog and Apps page', async ({ page }) => {
  const north = await register(page, 'E2E settings north', [{ app: appId, settings: { assetTypes: ['urn:example:type:pump'], serialIdName: 'plantSerial' } }])
  const south = await register(page, 'E2E settings south', [])

  await page.goto(`/targets/${north}/apps/${installationId}/asset-board`)
  await expect(board(page).locator('[data-test="settings"]')).toContainText('urn:example:type:pump')
  await expect(board(page).locator('[data-test="settings"]')).toContainText('Serial: plantSerial')
  await expect(board(page).locator('[data-test="settings"]')).toContainText('25 per page')

  // South has no asset types yet: the app says so instead of listing.
  await page.goto(`/targets/${south}/apps/${installationId}/asset-board`)
  await expect(board(page).locator('[data-test="not-configured"]')).toBeVisible()

  // An administrator sets them in the infrastructure's dialog.
  await page.goto('/?panel=infrastructures')
  await page.getByText('E2E settings south', { exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('button', { name: /Asset board/ }).click()
  const types = dialog.getByRole('combobox', { name: 'Asset types' })
  await types.fill('urn:example:type:compressor')
  await types.press('Enter')
  await dialog.getByRole('button', { name: 'Save' }).click()
  await expect(dialog).toHaveCount(0)

  // And the page size for every infrastructure on the Apps page.
  await page.goto('/?panel=apps')
  await page.getByRole('listitem').filter({ hasText: appId }).hover()
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByRole('dialog').getByRole('spinbutton', { name: 'Shells per page' }).fill('50')
  await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)

  await page.goto(`/targets/${south}/apps/${installationId}/asset-board`)
  await expect(board(page).locator('[data-test="settings"]')).toContainText('urn:example:type:compressor')
  await expect(board(page).locator('[data-test="settings"]')).toContainText('Serial: serialNumber')
  await expect(board(page).locator('[data-test="settings"]')).toContainText('50 per page')
  await expect(board(page).locator('[data-test="not-configured"]')).toHaveCount(0)

  await page.goto(`/targets/${north}/apps/${installationId}/asset-board`)
  await expect(board(page).locator('[data-test="settings"]')).toContainText('urn:example:type:pump')
  await expect(board(page).locator('[data-test="settings"]')).toContainText('50 per page')
})

test('drops values the installed version does not take on the next save, and keeps empty ones', async ({ page }) => {
  // Values written before the app was installed are kept unchecked.
  await uninstallAllApps(page)
  const west = await register(page, 'E2E settings west', [{ app: appId, settings: { assetTypes: [], colour: 'red' } }])
  installationId = await installApp(page, new Uint8Array(await readFile(join(root, 'examples/apps/dist/asset-board.zip'))))

  // An empty list is a value: it replaces the default, so the app is not configured.
  await page.goto(`/targets/${west}/apps/${installationId}/asset-board`)
  await expect(board(page).locator('[data-test="not-configured"]')).toBeVisible()

  await page.goto('/?panel=infrastructures')
  await page.getByText('E2E settings west', { exact: true }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.locator('[data-test="obsolete-settings"]')).toContainText('colour')
  await dialog.getByRole('button', { name: 'Save' }).click()
  await expect(dialog).toHaveCount(0)

  const saved = await (await (await studioApi(page)).get(`/infrastructures/${west}`)).json() as { apps: unknown[] }
  expect(saved.apps).toEqual([{ app: appId, settings: { assetTypes: [] } }])
})

test('refuses values of the wrong type', async ({ page }) => {
  const api = await studioApi(page)
  const installation = await api.put(`/app-installations/${installationId}/settings`, { values: { pageSize: 'many' } })
  expect(installation.status()).toBe(400)
  expect((await installation.json()).violations).toEqual([{ path: 'values.pageSize', message: 'must be a finite number' }])

  const infrastructure = await api.post('/infrastructures', {
    name: 'E2E settings refused',
    template: 'full',
    endpoints: [{ type: 'aasRepository', url: openTargetUrl }, { type: 'submodelRepository', url: openTargetUrl }],
    security: { mode: 'unsecured' },
    allowPrivateNetwork: true,
    apps: [{ app: appId, settings: { assetTypes: 'urn:example:type:pump', pageSize: 10 } }],
  })
  expect(infrastructure.status()).toBe(400)
  expect((await infrastructure.json()).violations.map((violation: { path: string }) => violation.path)).toEqual(['apps.0.settings.assetTypes', 'apps.0.settings.pageSize'])
})
