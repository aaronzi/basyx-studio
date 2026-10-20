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

/** Clicks into the app once its frame stopped growing and moving: a click into a frame the Overview is still placing can be lost. */
async function click (page: Page, name: string | RegExp, role: 'button' | 'treeitem' | 'option' = 'button') {
  const target = filesFrame(page).getByRole(role, { name }).first()
  await expect(target).toBeVisible({ timeout: 30_000 })
  await waitUntilSettled(page.locator('iframe[title="App: Files"]'))
  await target.click()
}

async function expectNotice (page: Page, text: string | RegExp) {
  await expect(filesFrame(page).locator('[data-test="notice"]')).toContainText(text, { timeout: 30_000 })
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

test('manages files and folders in edit mode and previews them', async ({ page }) => {
  test.setTimeout(120_000)
  await signIn(page, 'studio-admin')
  await page.goto(`/targets/${targetId}/shells/${key(shellId)}?tab=overview`)
  const frame = filesFrame(page)
  await expect(frame.locator('[data-test="empty"]')).toContainText('no files or folders', { timeout: 30_000 })
  // View mode offers no changes.
  await expect(frame.locator('[data-test="upload"]')).toHaveCount(0)

  await setMode(page, 'Edit')
  await expect(frame.locator('[data-test="upload"]')).toBeVisible()
  await frame.locator('[data-test="file-input"]').setInputFiles([
    { name: 'readme.txt', mimeType: 'text/plain', buffer: Buffer.from('Hello from the Files app') },
    { name: 'Manual.pdf', mimeType: 'application/pdf', buffer: pdf('Operating manual') },
    { name: 'photo.png', mimeType: 'image/png', buffer: png },
  ])
  await expectNotice(page, 'Uploaded: 3')
  await expect(frame.locator('[data-test="counts"]')).toHaveText('Folders: 0 · Files: 3')

  // Previews: text, an image and a PDF drawn by PDF.js.
  await click(page, 'readme.txt', 'treeitem')
  await expect(frame.locator('[data-test="text-preview"]')).toHaveText('Hello from the Files app')
  await click(page, 'photo.png', 'treeitem')
  await expect(frame.locator('[data-test="image-preview"] img')).toBeVisible()
  await click(page, 'Manual.pdf', 'treeitem')
  await expect(frame.locator('[data-test="pdf-preview"] canvas')).toBeVisible()
  await expect(frame.locator('[data-test="pdf-preview"]')).not.toContainText('could not be shown')
  await expect.poll(() => frame.locator('[data-test="pdf-preview"] canvas').evaluate((canvas: HTMLCanvasElement) => {
    // Some pixel of the page is not white: the text was drawn.
    const data = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data
    return canvas.width > 0 && data.some((value, index) => index % 4 !== 3 && value < 200)
  }), { timeout: 30_000 }).toBe(true)

  // A folder, with the file moved into it.
  await click(page, 'New folder')
  await frame.locator('[data-test="name-field"] input').fill('Manuals')
  await click(page, 'Create')
  await expectNotice(page, 'Folder Manuals created.')
  await click(page, 'Manual.pdf', 'treeitem')
  await click(page, 'Move')
  await frame.locator('[data-test="move-target"]').click()
  await click(page, 'Manuals', 'option')
  await click(page, /^Move$/)
  await expectNotice(page, 'Manual.pdf moved.')
  await expect(frame.locator('[data-test="selected-name"]')).toHaveText('Manual.pdf')
  await expect(frame.locator('[data-test="pdf-preview"] canvas')).toBeVisible()

  // The folder is renamed by its display name; its file keeps its content.
  await click(page, 'Manuals', 'treeitem')
  await click(page, 'Rename')
  await frame.locator('[data-test="name-field"] input').fill('Handbooks')
  await click(page, 'Save')
  await expectNotice(page, 'Renamed to Handbooks.')
  await expect(frame.locator('[data-test="folder-content"]')).toContainText('Manual.pdf')

  // Deleting a file asks first.
  await click(page, 'readme.txt', 'treeitem')
  await click(page, 'Delete')
  await expect(frame.locator('[data-test="delete-question"]')).toHaveText('Delete readme.txt?')
  await click(page, /^Delete$/)
  await expectNotice(page, 'readme.txt deleted.')
  await expect(frame.locator('[data-test="counts"]')).toHaveText('Folders: 1 · Files: 2')

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
