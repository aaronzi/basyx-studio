import type { FrameLocator, Locator, Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { key, registerOpenTarget, signIn, waitUntilSettled } from './support'

// The bundled Documents app for IDTA 02004 Handover Documentation on
// `HandoverDocumentationDemo` (test-setup/fixtures/open/studio-handover-documentation.aasx):
// documents, versions, files in the app's file viewer, search, class filter,
// relations and full screen, for the 2.0 and the 1.2 submodel.
// Run `pnpm build` first.

test.describe.configure({ mode: 'serial' })

const shell = 'urn:studio:test:aas:handover-documentation'
const v2 = 'urn:studio:test:sm:handover-documentation:2-0'
const v1 = 'urn:studio:test:sm:handover-documentation:1-2'
let targetId: string

const appFrame = (page: Page) => page.locator('iframe[title="App: Documents"]').first()

async function openSubmodel (page: Page, submodelId: string): Promise<FrameLocator> {
  await page.goto(`/targets/${targetId}/shells/${key(shell)}?submodel=${key(submodelId)}&mode=visualization`)
  const frame = page.frameLocator('iframe[title="App: Documents"]').first()
  await expect(frame.locator('[data-test="document-item"]').first()).toBeVisible({ timeout: 30_000 })
  return frame
}

/** Clicks into the app once its frame stopped growing and moving. */
async function clickInApp (page: Page, target: Locator) {
  await expect(target).toBeVisible({ timeout: 30_000 })
  await waitUntilSettled(appFrame(page))
  await target.click()
}

test.beforeEach(async ({ page }) => {
  await signIn(page, 'studio-admin')
  targetId = await registerOpenTarget(page, 'E2E handover documentation target')
})

test('shows the documents of IDTA 02004 2.0 with versions, files and the file viewer', async ({ page }) => {
  const frame = await openSubmodel(page, v2)
  await expect(frame.locator('[data-test="document-item"]')).toHaveCount(9)
  await expect(frame.locator('[data-test="document-title"]')).toHaveText('Operating manual')
  await expect(frame.locator('[data-test="document-status"]')).toHaveText('Released')
  await expect(frame.locator('[data-test="version-menu"]')).toHaveText('v2.0')

  // The latest version's first file, inline; its second file and its preview image are a click away.
  const viewer = frame.locator('[data-test="file-viewer"]')
  await expect(viewer.locator('[data-test="file-viewer-name"]')).toHaveText('gm40-operating-manual-en.pdf', { timeout: 30_000 })
  await expect(viewer.locator('[data-test="pdf-page"]')).toHaveText('Page 1 of 5', { timeout: 30_000 })
  await clickInApp(page, frame.locator('[data-test="document-files"]').getByRole('button', { name: 'gm40-betriebsanleitung-de.pdf' }))
  await expect(viewer.locator('[data-test="file-viewer-name"]')).toHaveText('gm40-betriebsanleitung-de.pdf', { timeout: 30_000 })
  await clickInApp(page, frame.locator('[data-test="document-files"]').getByRole('button', { name: 'Preview image' }))
  await expect(viewer.locator('[data-test="file-viewer-image"] img')).toBeVisible({ timeout: 30_000 })

  // An older version.
  await clickInApp(page, frame.locator('[data-test="version-menu"]'))
  await clickInApp(page, frame.locator('.v-overlay__content').getByRole('listitem').filter({ hasText: 'v1.0' }))
  await expect(frame.locator('[data-test="version-menu"]')).toHaveText('v1.0')
  await expect(viewer.locator('[data-test="file-viewer-name"]')).toHaveText('gm40-operating-manual-en-1.0.pdf', { timeout: 30_000 })
  await expect(viewer.locator('[data-test="pdf-page"]')).toHaveText('Page 1 of 3', { timeout: 30_000 })

  // A CSV file, a document without a file.
  await clickInApp(page, frame.locator('[data-test="document-item"]').filter({ hasText: 'Spare parts list' }))
  await expect(viewer.locator('[data-test="file-viewer-csv"]')).toContainText('GM40-101', { timeout: 30_000 })
  await clickInApp(page, frame.locator('[data-test="document-item"]').filter({ hasText: 'Service contract' }))
  await expect(frame.locator('[data-test="document-preview"]')).toContainText('This version has no file.')
})

test('searches and filters documents, and follows relations between them', async ({ page }) => {
  const frame = await openSubmodel(page, v2)

  await clickInApp(page, frame.locator('[data-test="document-search"] input'))
  await frame.locator('[data-test="document-search"] input').fill('frequency converter')
  await expect(frame.locator('[data-test="document-item"]')).toHaveCount(1)
  await expect(frame.locator('[data-test="document-count"]')).toHaveText('1 of 9 documents')
  await frame.locator('[data-test="document-search"] input').fill('')

  await clickInApp(page, frame.locator('[data-test="document-classes"]').getByText('Drawings, plans'))
  await expect(frame.locator('[data-test="document-item"]')).toHaveCount(1)
  await expect(frame.locator('[data-test="document-title"]')).toHaveText('Dimension drawing')
  await clickInApp(page, frame.locator('[data-test="document-classes"]').getByText('Drawings, plans'))
  await expect(frame.locator('[data-test="document-item"]')).toHaveCount(9)

  // The maintenance instructions in review refer to the spare parts list.
  await clickInApp(page, frame.locator('[data-test="document-item"]').filter({ hasText: 'Maintenance instructions' }))
  await expect(frame.locator('[data-test="document-status"]')).toHaveText('In review')
  await clickInApp(page, frame.locator('[data-test="technical-details"]').getByText('Technical details'))
  await clickInApp(page, frame.locator('[data-test="definition-link"]').filter({ hasText: 'Spare parts list' }))
  await expect(frame.locator('[data-test="document-title"]')).toHaveText('Spare parts list')
})

test('opens the selected document and version in full screen', async ({ page }) => {
  const frame = await openSubmodel(page, v2)
  await clickInApp(page, frame.locator('[data-test="document-item"]').filter({ hasText: 'Dimension drawing' }))
  await clickInApp(page, frame.locator('[data-test="document-files"]').getByRole('button', { name: 'SVG' }))
  await clickInApp(page, frame.locator('[data-test="document-fullscreen"]'))

  const dialogFrame = page.frameLocator('.v-dialog iframe[title="App: Documents"]')
  await expect(dialogFrame.locator('[data-test="document-title"]')).toHaveText('Dimension drawing', { timeout: 30_000 })
  await expect(dialogFrame.locator('[data-test="file-viewer-name"]')).toHaveText('gm40-dimension-drawing.svg', { timeout: 30_000 })
  await page.locator('[data-test="app-fullscreen-close"]').click()
  await expect(page.locator('.v-dialog')).toBeHidden()
})

test('shows the documents of IDTA 02004 1.2', async ({ page }) => {
  const frame = await openSubmodel(page, v1)
  await expect(frame.locator('[data-test="document-item"]')).toHaveCount(3)
  await expect(frame.locator('[data-test="document-title"]')).toHaveText('Operating manual')
  await expect(frame.locator('[data-test="version-menu"]')).toHaveText('v2.0')
  await expect(frame.locator('[data-test="file-viewer-name"]')).toHaveText('gm40-operating-manual-en.pdf', { timeout: 30_000 })

  // The declaration refers to the manual, by a reference into this submodel.
  await clickInApp(page, frame.locator('[data-test="document-item"]').filter({ hasText: 'EU declaration of conformity' }))
  await clickInApp(page, frame.locator('[data-test="technical-details"]').getByText('Technical details'))
  await clickInApp(page, frame.locator('[data-test="definition-link"]').filter({ hasText: 'Operating manual' }))
  await expect(frame.locator('[data-test="document-title"]')).toHaveText('Operating manual')
})
