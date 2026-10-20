import type { Page, TestInfo } from '@playwright/test'
import type { Server } from 'node:http'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { fixturesDirectory, zipDirectory } from '../../apps/support'

// One origin per installation, declared third-party origins and full-page
// modules (ADR 0045), against a Studio with an origin per installation and
// one with a shared apps origin (origins.config.ts).

test.describe.configure({ mode: 'serial' })

/** The "third party": embed.localhost and undeclared.localhost on one port. */
let thirdParty: Server

test.beforeAll(async () => {
  thirdParty = createServer((request, response) => {
    if (request.url === '/embed.html') {
      response.setHeader('Content-Type', 'text/html')
      // Reports its origin to the app, and whether it may use cookies.
      response.end(`<script>
        let cookies
        try { document.cookie = 'embed=1'; cookies = 'allowed' } catch (error) { cookies = 'blocked (' + error.name + ')' }
        parent.postMessage({ type: 'embed', origin: self.origin, cookies }, '*')
      </script>`)
      return
    }
    if (request.url === '/data.json') {
      response.setHeader('Content-Type', 'application/json')
      response.setHeader('Access-Control-Allow-Origin', '*')
      response.end('{"ok":true}')
      return
    }
    response.statusCode = 404
    response.end()
  })
  await new Promise<void>(resolve => thirdParty.listen(3402, resolve))
})

test.afterAll(async () => {
  await new Promise(resolve => thirdParty.close(resolve))
})

const installationOrigins = (info: TestInfo) => info.project.name === 'installation-origins'

/** Installs the probe through the Apps page, which shows the origins for consent. */
async function installProbe (page: Page, info: TestInfo) {
  await page.goto('/?panel=apps')
  await page.locator('input[type="file"][accept^=".zip"]').setInputFiles({
    name: 'origin-probe.zip',
    mimeType: 'application/zip',
    buffer: Buffer.from(await zipDirectory(join(fixturesDirectory, 'origin-probe'))),
  })
  await page.getByRole('button', { name: 'Install app' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByText('http://embed.localhost:3402')).toHaveCount(2)
  await expect(dialog.getByText('Embeds pages from')).toBeVisible()
  await expect(dialog.getByText('Sends requests to')).toBeVisible()
  await expect(dialog.getByText('Your browser contacts these origins directly.', { exact: false })).toBeVisible()
  await expect(dialog.getByText('This Studio serves all apps from one origin.', { exact: false })).toHaveCount(installationOrigins(info) ? 0 : 1)
  await dialog.getByRole('button', { name: 'Install', exact: true }).click()
  await expect(page.getByText('Installed Origin probe')).toBeVisible()
}

test('runs an app in its own origin or an opaque one, with its declared origins only', async ({ page }, info) => {
  await installProbe(page, info)
  // The module is an entry of the navigation rail; the Apps panel covers the page.
  const href = await page.getByRole('link', { name: 'Origin probe' }).getAttribute('href')
  const installationId = /\/apps\/(app-[\da-f]{16})\/probe$/.exec(href ?? '')![1]!
  await page.goto(href!)

  const element = page.locator('iframe[title="App: Origin probe"]')
  const frame = page.frameLocator('iframe[title="App: Origin probe"]')
  await expect(frame.locator('body[data-done="true"]')).toBeAttached({ timeout: 30_000 })
  const results = JSON.parse(await frame.locator('#results').textContent() ?? '{}') as Record<string, unknown>

  // Either way: the bridge connects, declared origins work, nothing else.
  expect(results).toMatchObject({
    bridge: 'connected',
    parentDocument: expect.stringMatching(/^blocked/),
    declaredFetch: 200,
    undeclaredFetch: expect.stringMatching(/^blocked/),
    foreignAppScript: expect.stringMatching(/^blocked/),
    serviceWorker: expect.stringMatching(/^blocked/),
    embeds: 1,
  })
  expect(results.violations).toEqual(expect.arrayContaining(['connect-src', 'frame-src', 'script-src-elem']))

  if (installationOrigins(info)) {
    // Its own origin, and the embedded page keeps its own (ADR 0045).
    await expect(element).toHaveAttribute('sandbox', 'allow-scripts allow-same-origin')
    expect(results).toMatchObject({
      origin: `http://${installationId}.apps.localhost:3400`,
      localStorage: 'allowed',
      embedOrigin: 'http://embed.localhost:3402',
      embedCookies: 'allowed',
    })
  } else {
    // Opaque as in ADR 0017, and so is the embedded page: no cookies.
    await expect(element).toHaveAttribute('sandbox', 'allow-scripts')
    expect(results).toMatchObject({
      origin: 'null',
      localStorage: expect.stringMatching(/^blocked/),
      embedOrigin: 'null',
      embedCookies: expect.stringMatching(/^blocked \(SecurityError\)/),
    })
  }
})

test('serves an installation\'s files on its own origin only', async ({ page, request }, info) => {
  test.skip(!installationOrigins(info), 'one origin per installation only')
  await page.goto('/?panel=apps')
  const contributions = await (await request.get('/api/studio/v1/app-contributions')).json() as { modules: Array<{ installationId: string, entryUrl: string, frameOrigin: string | null, layout: string }> }
  const probe = contributions.modules.find(module => module.entryUrl.endsWith('/ui/index.html') && module.layout === 'fullPage')!
  expect(probe.frameOrigin).toBe(`http://${probe.installationId}.apps.localhost:3400`)
  const path = `/app/${probe.installationId}/ui/index.html`
  const status = async (host: string) => (await request.get(`http://127.0.0.1:3400${path}`, { headers: { Host: host } })).status()
  expect(await status(`${probe.installationId}.apps.localhost:3400`)).toBe(200)
  expect(await status('app-0000000000000000.apps.localhost:3400')).toBe(404)
  expect(await status('localhost:3400')).toBe(404)
  // No Studio pages or API on an apps origin.
  expect((await request.get('http://127.0.0.1:3400/api/studio/v1/context', { headers: { Host: `${probe.installationId}.apps.localhost:3400` } })).status()).toBe(404)
})

test('shows a full-page module from the rail to the edges, without header or card', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Origin probe' }).click()
  await expect(page).toHaveURL(/\/apps\/app-[\da-f]{16}\/probe$/)
  const element = page.locator('iframe[title="App: Origin probe"]')
  await expect(element).toBeVisible()
  await expect(page.locator('main .v-breadcrumbs')).toHaveCount(0)
  await expect(page.locator('main .v-card')).toHaveCount(0)
  const viewport = page.viewportSize()!
  const frame = (await element.boundingBox())!
  const rail = (await page.getByRole('navigation').first().boundingBox())!
  const bar = (await page.getByRole('banner').boundingBox())!
  // Beside the navigation rail, below the app bar, to the window's edges
  // (within the rail's and bar's 1 px borders).
  const near = (actual: number, expected: number) => expect(Math.abs(actual - expected)).toBeLessThanOrEqual(1)
  near(frame.x, rail.x + rail.width)
  near(frame.y, bar.y + bar.height)
  near(frame.x + frame.width, viewport.width)
  near(frame.y + frame.height, viewport.height)
})
