import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { key, openTargetUrl, registerOpenTarget, setMode, signIn, studioApi, waitUntilSettled } from './support'

// The file viewer (ADR 0052) on `FilePreviewsDemo`
// (test-setup/fixtures/open/studio-file-previews.aasx): Studio's file view in
// the Visualization tab, its full-screen dialog, text editing with
// revisions, and the dialog opened from an app (`studio.ui.previewFile`).
// Run `pnpm build` and `pnpm apps:build` first.

test.describe.configure({ mode: 'serial' })

const shell = 'urn:studio:test:aas:file-previews'
const formats = 'urn:studio:test:sm:file-previews:file-formats'
const handover = 'urn:studio:test:sm:file-previews:handover-documentation'
/** A shell only this file writes to. */
const writesShell = 'urn:studio:test:aas:file-viewer-writes'
const writesSubmodel = 'urn:studio:test:sm:file-viewer-writes-e2e'
let targetId: string

function elementUrl (element: string, mode = 'visualization') {
  return `/targets/${targetId}/shells/${key(shell)}?submodel=${key(formats)}&element=${key(element)}&mode=${mode}`
}

const viewer = (page: Page) => page.locator('[data-test="file-viewer"]').first()
const dialog = (page: Page) => page.locator('[data-test="file-viewer-dialog"]')

test.beforeAll(async ({ browser }) => {
  const page = await browser.newPage()
  await signIn(page, 'studio-admin')
  targetId = await registerOpenTarget(page, 'E2E file viewer target')
  const api = await studioApi(page)
  await api.delete(`/targets/${targetId}/shells/${key(writesShell)}?deleteSubmodels=true`)
  const created = await api.post(`/targets/${targetId}/shells`, {
    shell: { id: writesShell, idShort: 'FileViewerWrites', assetInformation: { assetKind: 'Instance', globalAssetId: `${writesShell}:asset` } },
    submodels: [{
      source: 'json',
      submodel: {
        modelType: 'Submodel',
        id: writesSubmodel,
        idShort: 'Notes',
        submodelElements: [{ modelType: 'Blob', idShort: 'Notes', contentType: 'text/plain', value: Buffer.from('First line\n').toString('base64') }],
      },
    }],
  })
  expect(created.status(), await created.text()).toBe(201)
  await page.close()
})

test.afterAll(async ({ browser }) => {
  const page = await browser.newPage()
  await signIn(page, 'studio-admin')
  await (await studioApi(page)).delete(`/targets/${targetId}/shells/${key(writesShell)}?deleteSubmodels=true`)
  await page.close()
})

test.beforeEach(async ({ page }) => {
  await signIn(page, 'studio-admin')
})

test('describes a file in the details tab and shows it in the Visualization tab', async ({ page }) => {
  await page.goto(elementUrl('Text.Markdown', 'details'))
  const card = page.locator('[data-test="file-value"]')
  await expect(card).toContainText('release-notes.md')
  await expect(card.locator('[data-test="file-thumbnail"]')).toBeVisible()
  // No viewer starts in the details tab.
  await expect(page.locator('[data-test="file-viewer"]')).toHaveCount(0)

  await card.locator('[data-test="file-show-preview"]').click()
  await expect(page).toHaveURL(/mode=visualization/)
  const markdown = viewer(page).locator('[data-test="file-viewer-markdown"]')
  await expect(markdown.getByRole('heading', { name: 'Bracket BR-60' })).toBeVisible({ timeout: 30_000 })
  // Raw HTML shows as text; nothing of it runs or loads.
  await expect(markdown).toContainText('<script>alert(\'raw HTML script must never run\')</script>')
  await expect(markdown.locator('script, iframe, img')).toHaveCount(0)
  await expect(markdown.locator('a[href^="javascript:"]')).toHaveCount(0)
  await expect(markdown.locator('a[href="https://example.com/manual.pdf"]')).toHaveAttribute('rel', 'noopener noreferrer')

  // The toggle stays where it is when the text view adds its buttons.
  const views = viewer(page).locator('[data-test="file-viewer-views"]')
  const before = await views.boundingBox()
  await views.getByRole('button', { name: 'Source' }).click()
  await expect(viewer(page).locator('[data-test="file-viewer-text"] .monaco-editor')).toContainText('# Bracket BR-60', { timeout: 30_000 })
  // Highlighted: the production build keeps the languages @basyx/file-viewer/monaco registers.
  await expect.poll(() => viewer(page).locator('[data-test="file-viewer-text"] .view-line span span').evaluateAll(spans => new Set(spans.map(span => span.className)).size)).toBeGreaterThan(1)
  expect((await views.boundingBox())?.x).toBe(before?.x)

  // Full-screen, Close is the last button, after the toggle.
  await viewer(page).locator('[data-test="file-viewer-maximize"]').click()
  const fullscreenViews = dialog(page).locator('[data-test="file-viewer-views"]')
  const close = dialog(page).locator('[data-test="file-viewer-close"]')
  await expect(close).toBeVisible({ timeout: 30_000 })
  expect((await close.boundingBox())!.x).toBeGreaterThan((await fullscreenViews.boundingBox())!.x)
  await close.click()
  await expect(dialog(page)).toBeHidden()
})

test('shows CSV as a table and pages through a PDF, also full-screen', async ({ page }) => {
  await page.goto(elementUrl('Text.CsvSemicolon'))
  const table = viewer(page).locator('[data-test="file-viewer-csv"]')
  await expect(table.getByRole('cell', { name: 'Winkel; verzinkt' })).toBeVisible({ timeout: 30_000 })
  await expect(table.getByRole('cell', { name: 'Winkel "Edelstahl"' })).toBeVisible()

  await page.goto(elementUrl('Documents.PdfMultiPage'))
  await expect(viewer(page).locator('[data-test="pdf-page"]')).toHaveText('Page 1 of 5', { timeout: 30_000 })
  await viewer(page).locator('[data-test="pdf-next"]').click()
  await expect(viewer(page).locator('[data-test="pdf-page"]')).toHaveText('Page 2 of 5')
  // The full-screen dialog shows the same state.
  await viewer(page).locator('[data-test="file-viewer-maximize"]').click()
  await expect(dialog(page).locator('[data-test="pdf-page"]')).toHaveText('Page 2 of 5', { timeout: 30_000 })
  await dialog(page).locator('[data-test="file-viewer-name"]').click()
  await page.keyboard.press('Escape')
  await expect(dialog(page)).toBeHidden()
})

test('corrects misleading content types and shows Blobs as files', async ({ page }) => {
  await page.goto(elementUrl('Detection.TextAsPng'))
  await expect(viewer(page).locator('[data-test="file-viewer-text"]')).toBeVisible({ timeout: 30_000 })
  await page.goto(elementUrl('Detection.BinaryAsText'))
  await expect(viewer(page).locator('[data-test="file-viewer-none"]')).toBeVisible({ timeout: 30_000 })
  await page.goto(elementUrl('Missing.NotOnServer'))
  await expect(viewer(page).locator('[data-test="file-viewer-error"]')).toBeVisible({ timeout: 30_000 })

  await page.goto(elementUrl('Blobs.StlBlob'))
  await expect(viewer(page).locator('[data-test="model-view-canvas"] canvas')).toBeVisible({ timeout: 30_000 })
  await expect(viewer(page).getByText(/\d+ triangles/)).toBeVisible({ timeout: 30_000 })
})

test('edits a text in edit mode, saves it with its revision and detects a conflict', async ({ page, request }) => {
  await page.goto(`/targets/${targetId}/shells/${key(writesShell)}?submodel=${key(writesSubmodel)}&element=${key('Notes')}&mode=visualization`)
  await setMode(page, 'Edit')
  const editor = viewer(page).locator('[data-test="file-viewer-text"] .monaco-editor')
  await expect(editor).toContainText('First line', { timeout: 30_000 })
  await editor.locator('.view-lines').click()
  await page.keyboard.press('ControlOrMeta+End')
  await page.keyboard.type('Second line')
  await expect(viewer(page).locator('[data-test="file-viewer-unsaved"]')).toBeVisible()
  await viewer(page).locator('[data-test="file-viewer-save"]').click()
  await expect(viewer(page).locator('[data-test="file-viewer-unsaved"]')).toHaveCount(0, { timeout: 30_000 })
  const element = `${openTargetUrl}/submodels/${key(writesSubmodel)}/submodel-elements/Notes?extent=withBlobValue`
  const saved = await (await request.get(element)).json() as { value: string }
  expect(Buffer.from(saved.value, 'base64').toString('utf8')).toBe('First line\nSecond line')

  // Someone else changes the Blob; the next save finds a newer revision.
  await editor.locator('.view-lines').click()
  await page.keyboard.press('ControlOrMeta+End')
  await page.keyboard.type('!')
  const changed = await request.put(element.replace('?extent=withBlobValue', ''), {
    data: { modelType: 'Blob', idShort: 'Notes', contentType: 'text/plain', value: Buffer.from('Changed elsewhere\n').toString('base64') },
  })
  expect(changed.ok()).toBe(true)
  await viewer(page).locator('[data-test="file-viewer-save"]').click()
  await expect(page.locator('[data-test="file-viewer-alerts"]')).toContainText(/older version|changed by someone else/, { timeout: 30_000 })
  await setMode(page, 'View')
})

test('opens a handover document from the app in Studio\'s viewer', async ({ page }) => {
  await page.goto(`/targets/${targetId}/shells/${key(shell)}?submodel=${key(handover)}&mode=visualization`)
  const app = page.locator('iframe[title="App: Documents"]')
  const frame = app.contentFrame()
  await expect(frame.locator('[data-test="document-item"]').filter({ hasText: 'Operating manual' })).toBeVisible({ timeout: 30_000 })
  // Documents with a preview image show it.
  await expect(frame.locator('[data-test="file-thumbnail"] img').first()).toBeVisible({ timeout: 30_000 })
  // The first document's file shows in the app's file viewer, maximize in Studio's.
  await expect(frame.locator('[data-test="file-viewer-name"]')).toHaveText('operating-manual.pdf', { timeout: 30_000 })
  await expect(frame.locator('[data-test="pdf-page"]')).toHaveText('Page 1 of 5', { timeout: 30_000 })
  await waitUntilSettled(app)
  await frame.locator('[data-test="file-viewer-maximize"]').click()
  await expect(dialog(page).locator('[data-test="file-viewer-name"]')).toHaveText('operating-manual.pdf', { timeout: 30_000 })
  await expect(dialog(page).locator('[data-test="pdf-page"]')).toHaveText('Page 1 of 5', { timeout: 30_000 })
  await dialog(page).locator('[data-test="file-viewer-close"]').click()
  await expect(dialog(page)).toBeHidden()
})
