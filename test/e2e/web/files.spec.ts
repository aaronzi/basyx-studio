import type { FrameLocator, Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { key, registerOpenTarget, setMode, signIn, studioApi, waitUntilSettled } from './support'

// The bundled Files app (external apps plan X3) on a shell's Overview: a
// FileSystem submodel as folders and files with previews, and in edit mode
// uploads, folders, renames, moves and deletes through the structural app
// methods (ADR 0049). Run `pnpm build` first.

test.describe.configure({ mode: 'serial' })

const shellId = `urn:studio:test:e2e:files:${Date.now()}`
const submodelId = `${shellId}:sm`
let targetId: string

/** A one-page PDF with a line of text in a standard font. */
function pdf (text: string): Buffer {
  const stream = `BT /F1 24 Tf 72 720 Td (${text}) Tj ET`
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]
  let body = '%PDF-1.4\n'
  const offsets: number[] = []
  for (const [index, object] of objects.entries()) {
    offsets.push(body.length)
    body += `${index + 1} 0 obj\n${object}\nendobj\n`
  }
  const xref = body.length
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}`
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(body, 'latin1')
}

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64')

function filesFrame (page: Page): FrameLocator {
  return page.frameLocator('iframe[title="App: Files"]')
}

/** Clicks in the app once its frame stopped moving: a click into a frame the Overview is still placing can be lost. */
async function click (page: Page, selector: string, options: { hasText?: string | RegExp } = {}) {
  const target = filesFrame(page).locator(selector, options).first()
  await expect(target).toBeVisible({ timeout: 30_000 })
  await waitUntilSettled(page.locator('iframe[title="App: Files"]'))
  await target.click()
}

async function expectNotice (page: Page, text: string | RegExp) {
  await expect(filesFrame(page).locator('[data-test="notice"]')).toContainText(text, { timeout: 30_000 })
}

/** The card of a folder or file in the gallery. */
function card (page: Page, kind: 'folder' | 'file', name: string) {
  return filesFrame(page).locator(`[data-test="${kind}-card"]`, { hasText: name })
}

test.beforeAll(async ({ browser }) => {
  const page = await browser.newPage()
  await signIn(page, 'studio-admin')
  targetId = await registerOpenTarget(page, 'E2E files target')
  const api = await studioApi(page)
  const created = await api.post(`/targets/${targetId}/shells`, {
    shell: { id: shellId, idShort: 'FilesShell', assetInformation: { assetKind: 'Instance', globalAssetId: `${shellId}:asset` } },
    submodels: [{
      source: 'json',
      submodel: {
        modelType: 'Submodel',
        id: submodelId,
        idShort: 'FileSystem',
        semanticId: { type: 'ExternalReference', keys: [{ type: 'GlobalReference', value: 'https://basyx.org/FileSystem/FileSystem/0/1' }] },
      },
    }],
  })
  expect(created.status(), await created.text()).toBe(201)
  await page.close()
})

test.afterAll(async ({ browser }) => {
  const page = await browser.newPage()
  await signIn(page, 'studio-admin')
  await (await studioApi(page)).delete(`/targets/${targetId}/shells/${key(shellId)}?deleteSubmodels=true`)
  await page.close()
})

test('manages files and folders as the Web UI does, in edit mode, and previews them', async ({ page }) => {
  test.setTimeout(120_000)
  await signIn(page, 'studio-admin')
  await page.goto(`/targets/${targetId}/shells/${key(shellId)}?tab=overview`)
  const frame = filesFrame(page)
  await expect(frame.locator('[data-test="empty"]')).toContainText('No files or folders', { timeout: 30_000 })
  // View mode offers no changes.
  await expect(frame.locator('[data-test="new"]')).toHaveCount(0)

  // New → Upload files, as in the Web UI.
  await setMode(page, 'Edit')
  await click(page, '[data-test="new"]')
  await click(page, '[data-test="upload"]')
  await frame.locator('[data-test="file-input"] input[type="file"]').setInputFiles([
    { name: 'readme.txt', mimeType: 'text/plain', buffer: Buffer.from('Hello from the Files app') },
    { name: 'Manual.pdf', mimeType: 'application/pdf', buffer: pdf('Operating manual') },
    { name: 'photo.png', mimeType: 'image/png', buffer: png },
  ])
  await click(page, '[data-test="dialog-submit"]')
  await expectNotice(page, 'Uploaded: 3')
  await expect(frame.locator('[data-test="file-card"]')).toHaveCount(3)
  // Images get a thumbnail.
  await expect(card(page, 'file', 'photo.png').locator('img')).toBeVisible()

  // A file opens in Studio's full-screen dialog, previewed there: the PDF drawn by PDF.js.
  await card(page, 'file', 'Manual.pdf').locator('.v-card-item').click()
  const dialog = page.frameLocator('.v-dialog iframe[title="App: Files"]')
  await expect(dialog.locator('[data-test="preview-name"]')).toHaveText('Manual.pdf', { timeout: 30_000 })
  await expect.poll(() => dialog.locator('[data-test="pdf-preview"] canvas').evaluate((canvas: HTMLCanvasElement) => {
    // Some pixel of the page is not white: the text was drawn.
    const data = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data
    return canvas.width > 0 && data.some((value, index) => index % 4 !== 3 && value < 200)
  }), { timeout: 30_000 }).toBe(true)
  // The preview fades in over the explorer; close it once it is there.
  await page.waitForTimeout(500)
  await dialog.locator('[data-test="preview-close"]').click()
  await expect(dialog.locator('[data-test="preview"]')).toBeHidden()
  await dialog.locator('[data-test="file-card"]', { hasText: 'readme.txt' }).locator('.v-card-item').click()
  await expect(dialog.locator('[data-test="text-preview"]')).toHaveText('Hello from the Files app')
  await page.locator('[data-test="app-fullscreen-close"]').click()
  await expect(page.locator('.v-dialog iframe[title="App: Files"]')).toHaveCount(0)

  // New → Create folder.
  await click(page, '[data-test="new"]')
  await click(page, '[data-test="create-folder"]')
  await frame.locator('[data-test="name-field"] input').fill('Manuals')
  await click(page, '[data-test="dialog-submit"]')
  await expectNotice(page, 'Folder Manuals created.')

  // Dragging a file onto a folder moves it there, with its content.
  await waitUntilSettled(page.locator('iframe[title="App: Files"]'))
  await card(page, 'file', 'Manual.pdf').dragTo(card(page, 'folder', 'Manuals'))
  await expectNotice(page, 'Moved: 1')
  await expect(frame.locator('[data-test="file-card"]')).toHaveCount(2)

  // The folder is renamed by its display name; its file keeps its content.
  await card(page, 'folder', 'Manuals').locator('[data-test="entry-menu"]').click()
  await click(page, '[data-test="menu-rename"]')
  await frame.locator('[data-test="name-field"] input').fill('Handbooks')
  await click(page, '[data-test="dialog-submit"]')
  await expectNotice(page, 'Renamed to Handbooks.')
  await click(page, '[data-test="folder-card"]', { hasText: 'Handbooks' })
  await expect(frame.locator('[data-test="breadcrumbs"]')).toContainText('Files/Handbooks')
  await expect(card(page, 'file', 'Manual.pdf')).toBeVisible()
  await click(page, '[data-test="up"]')

  // In the list view, deleting a file asks first.
  await click(page, '[data-test="view-list"]')
  await frame.locator('tr', { hasText: 'readme.txt' }).locator('[data-test="delete"]').click()
  await expect(frame.locator('[data-test="dialog-title"]')).toHaveText('Delete the file readme.txt?')
  await click(page, '[data-test="dialog-submit"]')
  await expectNotice(page, 'Deleted: 1')
  await expect(frame.locator('[data-test="list-entry"]')).toHaveCount(2)
  await click(page, '[data-test="view-grid"]')

  // The submodel as the Web UI's FileSystem plugin reads it.
  const submodel = await (await (await studioApi(page)).get(`/targets/${targetId}/submodels/${key(submodelId)}?content=full`)).json() as { submodel: { submodelElements: Array<Record<string, unknown>> } }
  const elements = submodel.submodel.submodelElements
  const folder = elements.find(element => element.modelType === 'SubmodelElementCollection')!
  expect(folder).toMatchObject({
    idShort: expect.stringMatching(/^FOLDER_\d+$/),
    displayName: [{ language: 'en', text: 'Handbooks' }],
    semanticId: { keys: [{ type: 'GlobalReference', value: 'https://basyx.org/submodels/Folder' }] },
    value: [{ modelType: 'File', idShort: 'Manual', contentType: 'application/pdf' }],
  })
  expect(elements.filter(element => element.modelType === 'File').map(element => element.idShort)).toEqual(['photo'])
  const content = await (await studioApi(page)).get(`/targets/${targetId}/submodels/${key(submodelId)}/elements/${key(`${String(folder.idShort)}.Manual`)}/attachment`)
  expect((await content.body()).subarray(0, 5).toString()).toBe('%PDF-')
})
