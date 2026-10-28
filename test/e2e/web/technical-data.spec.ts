import type { FrameLocator, Locator, Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { key, openTargetUrl, registerOpenEnvironment, setAtSource, setMode, signIn, waitUntilSettled } from './support'

// The bundled Technical Data app on `TechnicalDataDemo` (IDTA 02003 2.0) and
// `TechnicalDataDemo12` (ZVEI 1.2) of test-setup/fixtures/open/studio-technical-data.aasx:
// the product at a glance, images in Studio's viewer, classes with the area
// they refer to, data sheets with units, names and definitions from the
// concept descriptions, search kept in full screen, and changing a Property
// and a Range in place. Run `pnpm build` first.

test.describe.configure({ mode: 'serial' })

const shell = 'urn:studio:test:aas:technical-data'
const submodel = 'urn:studio:test:sm:technical-data:2-0'
let targetId: string

const appFrame = (page: Page) => page.locator('iframe[title="App: Technical Data"]').first()

async function openSubmodel (page: Page, shellId: string, submodelId: string): Promise<FrameLocator> {
  await page.goto(`/targets/${targetId}/shells/${key(shellId)}?submodel=${key(submodelId)}&mode=visualization`)
  const frame = page.frameLocator('iframe[title="App: Technical Data"]').first()
  await expect(frame.locator('[data-test="product-title"]')).toBeVisible({ timeout: 30_000 })
  return frame
}

/** Clicks into the app once its frame stopped growing and moving. */
async function clickIn (page: Page, target: Locator) {
  await expect(target).toBeVisible({ timeout: 30_000 })
  await waitUntilSettled(appFrame(page))
  await target.click()
}

/** A data sheet's value row by its label. */
const sheetRow = (scope: Locator, label: string) => scope.locator('[data-test="sheet-row"]').filter({ has: scope.page().locator('[data-test="sheet-label"]', { hasText: label }) })

test.beforeEach(async ({ page }) => {
  await signIn(page, 'studio-admin')
  targetId = await registerOpenEnvironment(page, 'E2E technical data environment')
})

test('shows Technical Data 2.0 as a data sheet with units, classes, images and further information', async ({ page }) => {
  const frame = await openSubmodel(page, shell, submodel)
  await expect(frame.locator('[data-test="product-title"]')).toHaveText('Servo drive SD-200')
  await expect(frame.locator('[data-test="manufacturer-name"]')).toHaveText('Example Drives GmbH')
  await expect(frame.locator('[data-test="product-details"]')).toHaveText('Art. no. SD-200-400-3 · Order code SD200-4-3-B')
  await expect(frame.locator('[data-test="classification-chip"]')).toHaveText(['ECLASS 14.0 · 27-02-31-90', 'IEC CDD 2.0 · ZZB001'])
  await expect(frame.locator('[data-test="valid-date"]')).toHaveText('Valid from Jan 15, 2026')
  await expect(frame.locator('[data-test="template-version"]')).toHaveText('IDTA 02003-2-0')
  await expect(frame.locator('[data-test="company-logo"] img')).toBeVisible({ timeout: 30_000 })

  // Three images, each its own, with their notes.
  await expect(frame.locator('[data-test="product-image"]')).toHaveCount(3)
  await expect(frame.locator('[data-test="product-image-note"]')).toHaveText(['Front view', 'Connectors at the bottom'])

  // The classes in the template's columns, the ECLASS one with its area.
  const classes = frame.locator('[data-test="classification"]')
  await expect(classes).toHaveCount(2)
  await expect(classes.first()).toContainText('Servo drive (demo class)')
  await expect(classes.first().locator('[data-test="classification-area"]')).toHaveText('Electrical')

  // Data sheets: the two areas and the specific descriptions.
  const areas = frame.locator('[data-test="property-area"]')
  await expect(areas).toHaveCount(3)
  await expect(areas.nth(0)).toContainText('Electrical')
  await expect(areas.nth(2)).toContainText('Functional safety')
  const electrical = areas.nth(0)
  await expect(sheetRow(electrical, 'Rated power').locator('[data-test="sheet-value"]')).toHaveText('3.0')
  await expect(sheetRow(electrical, 'Rated power').locator('[data-test="sheet-unit"]')).toHaveText('kW')
  // Its concept description is under the api.eclass-cdp.com spelling of its ID.
  await expect(sheetRow(electrical, 'Rated current').locator('[data-test="sheet-unit"]')).toHaveText('A')
  await expect(electrical.locator('[data-test="sheet-section"]')).toHaveText(['Power supply', 'Protection'])
  await expect(sheetRow(electrical, 'Ambient temperature in operation').locator('[data-test="sheet-value"]')).toHaveText('-20 – 40')
  await expect(sheetRow(electrical, 'Installation altitude').locator('[data-test="sheet-value"]')).toHaveText('≤ 1000')
  await expect(sheetRow(electrical, 'Overvoltage protection').locator('[data-test="sheet-value"]')).toHaveText('Yes')
  // Named by its supplemental semantic ID's concept.
  await expect(sheetRow(areas.nth(2), 'Safety integrity level').locator('[data-test="sheet-value"]')).toHaveText('SIL 3')

  await expect(frame.locator('[data-test="further-information"]')).toContainText('Subject to technical changes.')

  // A drawing in the data sheet opens in Studio's viewer.
  await clickIn(page, sheetRow(electrical, 'Dimension drawing').locator('[data-test="sheet-file"]'))
  await expect(page.locator('[data-test="file-viewer-dialog"] [data-test="file-viewer-name"]')).toHaveText('sd-200-dimensions.svg', { timeout: 30_000 })
  await page.locator('[data-test="file-viewer-dialog"] [data-test="file-viewer-close"]').click()
  await expect(page.locator('[data-test="file-viewer-dialog"]')).toBeHidden()
})

test('searches every data sheet and keeps the search in full screen', async ({ page }) => {
  const frame = await openSubmodel(page, shell, submodel)
  const search = frame.locator('[data-test="sheet-search"] input')
  await clickIn(page, search)
  await search.fill('kA')
  await expect(frame.locator('[data-test="sheet-matches"]')).toHaveText('1 of 22 properties')
  await expect(frame.locator('[data-test="sheet-section"]')).toHaveText(['Power supply', 'Protection'])
  await expect(frame.locator('[data-test="sheet-label"]')).toHaveText(['Short-circuit current rating'])
  await search.fill('nothing like this')
  await expect(frame.locator('[data-test="sheet-no-matches"]')).toBeVisible()
  await search.fill('SIL')

  await clickIn(page, frame.locator('[data-test="technical-data-fullscreen"]'))
  const dialog = page.frameLocator('.v-dialog iframe[title="App: Technical Data"]')
  await expect(dialog.locator('[data-test="sheet-label"]')).toHaveText(['Safety integrity level'], { timeout: 30_000 })
  await expect(dialog.locator('[data-test="technical-data-fullscreen"]')).toHaveCount(0)
  await page.locator('[data-test="app-fullscreen-close"]').click()
  await expect(page.locator('.v-dialog')).toBeHidden()
})

test('shows the area a class refers to', async ({ page }) => {
  const frame = await openSubmodel(page, shell, submodel)
  const search = frame.locator('[data-test="sheet-search"] input')
  await clickIn(page, search)
  // A search that hides the area is cleared.
  await search.fill('IP65')
  await clickIn(page, frame.locator('[data-test="classification-area"]'))
  await expect(search).toHaveValue('')
  await expect(frame.locator('[data-test="property-area"]').first()).toBeInViewport()
})

test('reads ZVEI Technical Data 1.2 with main and sub sections', async ({ page }) => {
  const frame = await openSubmodel(page, 'urn:studio:test:aas:technical-data-1-2', 'urn:studio:test:sm:technical-data:1-2')
  await expect(frame.locator('[data-test="template-version"]')).toHaveText('ZVEI Technical Data 1.2')
  // ValidDate has ManufacturerOrderCode's semantic ID in the 1.2 template.
  await expect(frame.locator('[data-test="valid-date"]')).toHaveText('Valid from Jun 1, 2023')
  await expect(frame.locator('[data-test="product-image"]')).toHaveCount(2)
  await expect(frame.locator('[data-test="sheet-section"]')).toHaveText(['Electrical', 'Supply', 'Mechanical'])
  await expect(sheetRow(frame.locator('[data-test="property-area"]'), 'Colour of housing').locator('[data-test="sheet-value"]')).toHaveText('Anthracite')
})

test('changes a Property and a Range in place in edit mode', async ({ page, request }) => {
  const frame = await openSubmodel(page, shell, submodel)
  await expect(frame.getByRole('button', { name: 'Edit Rated power' })).toHaveCount(0)
  await setMode(page, 'Edit')
  const electrical = frame.locator('[data-test="property-area"]').first()
  try {
    await clickIn(page, electrical.getByRole('button', { name: 'Edit Rated power' }))
    await frame.getByRole('textbox', { name: 'Rated power' }).fill('3.2')
    await frame.locator('[data-test="edit-save"]').click()
    await expect(frame.locator('[data-test="notice"]')).toContainText('Rated power saved.')
    await expect(sheetRow(electrical, 'Rated power').locator('[data-test="sheet-value"]')).toHaveText('3.2')

    await clickIn(page, electrical.getByRole('button', { name: 'Edit Ambient temperature in operation' }))
    await frame.locator('[data-test="edit-max"] input').fill('45')
    await frame.locator('[data-test="edit-save"]').click()
    await expect(sheetRow(electrical, 'Ambient temperature in operation').locator('[data-test="sheet-value"]')).toHaveText('-20 – 45')
  } finally {
    await setAtSource(request, submodel, 'TechnicalPropertyAreas[0].RatedPower', '3.0')
    // A Range's value-only form at BaSyx.
    const range = await request.patch(`${openTargetUrl}/submodels/${key(submodel)}/submodel-elements/TechnicalPropertyAreas[0].AmbientTemperature/$value`, { data: { min: -20, max: 40 } })
    expect(range.status()).toBe(204)
  }
})
