import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { key, registerOpenTarget, signIn } from './support'

// 3D models in the hosted build (ADR 0038, 0039): the 3D view of File
// elements in the Visualization tab, and the bundled 3D Models app for IDTA
// 02026, on `Models3DDemo` (test-setup/fixtures/open/studio-3d-models.aasx).
// Run `pnpm build` first.

test.describe.configure({ mode: 'serial' })

const shell = 'urn:studio:test:aas:models3d'
const files = 'urn:studio:test:sm:files-3d'
let targetId: string

function elementUrl (element: string) {
  return `/targets/${targetId}/shells/${key(shell)}?submodel=${key(files)}&element=${key(element)}&mode=visualization`
}

async function expectModel (page: Page, format: string) {
  const view = page.locator('[data-test="model-view"]')
  await expect(view.getByText(format, { exact: true })).toBeVisible({ timeout: 30_000 })
  await expect(view.getByText(/\d+ triangles?/)).toBeVisible({ timeout: 30_000 })
  await expect(view.locator('[data-test="model-view-canvas"] canvas')).toBeVisible()
}

test.beforeEach(async ({ page }) => {
  await signIn(page, 'studio-admin')
  targetId = await registerOpenTarget(page, 'E2E 3D models target')
})

test('shows STL, OBJ, glTF, GLB, STEP and IFC files in 3D', async ({ page }) => {
  test.setTimeout(120_000)
  for (const [element, format] of [['Stl', 'STL'], ['Obj', 'OBJ'], ['Gltf', 'glTF'], ['Glb', 'GLB'], ['Step', 'STEP'], ['Ifc', 'IFC']] as const) {
    await page.goto(elementUrl(element))
    await expectModel(page, format)
  }
  // IFC elements can be picked.
  await expect(page.locator('[data-test="model-view-element"]')).toContainText('Click an element to see its properties.')
})

test('offers the 3D view from the File card and explains files it cannot show', async ({ page }) => {
  await page.goto(`/targets/${targetId}/shells/${key(shell)}?submodel=${key(files)}&element=${key('Glb')}`)
  await page.locator('[data-test="file-view-3d"]').click()
  await expect(page).toHaveURL(/mode=visualization/)
  await expectModel(page, 'GLB')

  await page.goto(elementUrl('GltfExternalBuffer'))
  await expect(page.getByText('The 3D model cannot be shown')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText(/keeps its geometry in other files.*bracket\.bin/)).toBeVisible()

  // Not a 3D file: no Visualization tab.
  await page.goto(`/targets/${targetId}/shells/${key(shell)}?submodel=${key(files)}&element=${key('Preview')}`)
  await expect(page.getByRole('tab', { name: 'JSON' })).toBeVisible()
  await expect(page.getByRole('tab', { name: 'Visualization' })).toHaveCount(0)
})

test('shows the Models3D submodel in the bundled 3D Models app', async ({ page }) => {
  await page.goto(`/targets/${targetId}/shells/${key(shell)}?tab=overview`)
  const frame = page.frameLocator('iframe[title="App: 3D Models"]')
  await expect(frame.locator('[data-test="model-switcher-item"]')).toHaveCount(4, { timeout: 30_000 })
  await expect(frame.locator('[data-test="model-title"]')).toHaveText('L bracket')
  await expect(frame.locator('[data-test="viewer-canvas"] canvas')).toBeVisible({ timeout: 30_000 })
  await expect(frame.locator('[data-test="model-summary"]')).toContainText('Engineering design')

  // IFC in the app frame: web-ifc runs as WebAssembly in a blob: worker (ADR 0038).
  await frame.locator('[data-test="model-switcher-item"]').filter({ hasText: 'Workshop building' }).click()
  await expect(frame.locator('[data-test="viewer-element"]')).toContainText('Click an element to see its properties.', { timeout: 30_000 })

  // A version only at an external host shows its preview and the link.
  await frame.locator('[data-test="model-switcher-item"]').filter({ hasText: 'Motor (external)' }).click()
  await expect(frame.getByRole('button', { name: 'Open external file' })).toBeVisible()
})
