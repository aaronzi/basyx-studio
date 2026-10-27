import type { FrameLocator, Locator, Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { key, registerOpenTarget, setMode, signIn, waitUntilSettled } from './support'

// The bundled Digital Nameplate and Contacts apps on `NameplateDemo` and its
// 2.0 and 1.0 siblings (test-setup/fixtures/open/studio-nameplate.aasx):
// product, manufacturer with logo, address on the map and vCard, markings,
// asset specific properties, contacts with search, and changing a value in
// place. Run `pnpm build` first.

test.describe.configure({ mode: 'serial' })

const shell = 'urn:studio:test:aas:nameplate'
const nameplate = 'urn:studio:test:sm:nameplate:3-0'
const contacts = 'urn:studio:test:sm:nameplate:contact-information'
let targetId: string

const nameplateFrame = (page: Page) => page.locator('iframe[title="App: Digital Nameplate"]').first()
const contactsFrame = (page: Page) => page.locator('iframe[title="App: Contacts"]').first()

async function openSubmodel (page: Page, title: string, shellId: string, submodelId: string, ready: string): Promise<FrameLocator> {
  await page.goto(`/targets/${targetId}/shells/${key(shellId)}?submodel=${key(submodelId)}&mode=visualization`)
  const frame = page.frameLocator(`iframe[title="App: ${title}"]`).first()
  await expect(frame.locator(ready).first()).toBeVisible({ timeout: 30_000 })
  return frame
}

/** Clicks into an app once its frame stopped growing and moving. */
async function clickIn (frameElement: Locator, target: Locator) {
  await expect(target).toBeVisible({ timeout: 30_000 })
  await waitUntilSettled(frameElement)
  await target.click()
}

test.beforeEach(async ({ page }) => {
  await signIn(page, 'studio-admin')
  targetId = await registerOpenTarget(page, 'E2E nameplate target')
  // Map searches stay in the test: Studio opens them in a new tab.
  await page.context().route('https://www.openstreetmap.org/**', route => route.fulfill({ contentType: 'text/plain', body: 'map' }))
})

test('shows the Digital Nameplate 3.0 with logo, product, manufacturer, markings and asset specific properties', async ({ page }) => {
  const frame = await openSubmodel(page, 'Digital Nameplate', shell, nameplate, '[data-test="product-title"]')
  await expect(frame.locator('[data-test="product-title"]')).toHaveText('Gear motor GM-40')
  await expect(frame.locator('[data-test="manufacturer-name"]')).toHaveText('Example Drives GmbH')
  await expect(frame.locator('[data-test="product-details"]')).toHaveText('Type GM-40-230-B3 · SN GM40-2025-000123')
  await expect(frame.locator('[data-test="template-version"]')).toHaveText('IDTA 02006-3-0')
  await expect(frame.locator('[data-test="company-logo"] img')).toBeVisible({ timeout: 30_000 })
  await expect(frame.locator('[data-test="marking-chip"]')).toHaveText(['CE', 'UKCA', 'WEEE', 'Ex'])
  await expect(frame.locator('[data-test="versions"] .v-chip')).toHaveText(['Hardware 1.2', 'Firmware 3.4.1', 'Software 2.0.0'])

  const product = frame.locator('[data-test="product"]')
  await expect(product.locator('[data-field="CountryOfOrigin"]')).toContainText('Germany (DE)')
  await expect(product.locator('[data-field="DateOfManufacture"]')).toContainText('Mar 12, 2025')

  const manufacturer = frame.locator('[data-test="manufacturer"]')
  await expect(manufacturer).toContainText('Industriestraße 12')
  await expect(manufacturer).toContainText('67663 Kaiserslautern')
  await expect(manufacturer.locator('[data-test="detail-link"]').filter({ hasText: 'info@example.com' })).toBeVisible()
  await expect(manufacturer.locator('[data-test="detail-type"]').first()).toHaveText('Office')

  // The address opens in OpenStreetMap, through Studio: the frame opens no windows.
  const map = page.context().waitForEvent('request', request => request.isNavigationRequest() && request.url().startsWith('https://www.openstreetmap.org/search?query=Industriestra%C3%9Fe%2012'))
  await clickIn(nameplateFrame(page), manufacturer.locator('[data-test="show-on-map"]'))
  await map

  // The manufacturer as vCard, which Studio's page saves.
  const download = page.waitForEvent('download')
  await clickIn(nameplateFrame(page), frame.locator('[data-test="save-vcard"]'))
  const vcard = await download
  expect(vcard.suggestedFilename()).toBe('Example Drives GmbH.vcf')
  const text = (await vcard.createReadStream().then(async stream => {
    const chunks: Buffer[] = []
    for await (const chunk of stream) {
      chunks.push(chunk as Buffer)
    }
    return Buffer.concat(chunks)
  })).toString('utf8')
  expect(text).toContain('FN:Example Drives GmbH')
  expect(text).toContain('EMAIL;TYPE=INTERNET,WORK:info@example.com')

  // The markings with their certificates; the Ex certificate has expired.
  await expect(frame.locator('[data-test="marking"]')).toHaveCount(4)
  await expect(frame.locator('[data-test="marking"]').filter({ hasText: 'Ex' }).locator('[data-test="marking-expired"]')).toHaveText('Expired')
  await expect(frame.locator('[data-test="marking"]').first()).toContainText('EU-DoC GM40-2025-01')

  // The asset specific properties, collapsed, by guideline.
  await clickIn(nameplateFrame(page), frame.locator('[data-test="asset-specific-properties"]').getByText('Asset specific properties'))
  await expect(frame.locator('[data-test="property-group"]')).toHaveText(['General', 'Guideline 2006/42/EC', 'Guideline 2014/35/EU'])
})

test('reads the nameplate as 2.0 and 1.0', async ({ page }) => {
  const v2 = await openSubmodel(page, 'Digital Nameplate', 'urn:studio:test:aas:nameplate-2-0', 'urn:studio:test:sm:nameplate:2-0', '[data-test="product-title"]')
  await expect(v2.locator('[data-test="template-version"]')).toHaveText('IDTA 02006-2-0')
  await expect(v2.locator('[data-test="product-details"]')).toHaveText('Type GM-40-230-B3 · SN GM40-2023-000045')
  await expect(v2.locator('[data-test="manufacturer"]')).toContainText('67663 Kaiserslautern')
  await expect(v2.locator('[data-test="marking-chip"]')).toHaveText(['CE', 'WEEE'])

  const v1 = await openSubmodel(page, 'Digital Nameplate', 'urn:studio:test:aas:nameplate-1-0', 'urn:studio:test:sm:nameplate:1-0', '[data-test="product-title"]')
  await expect(v1.locator('[data-test="product-title"]')).toHaveText('Gear motor GM-25')
  await expect(v1.locator('[data-test="template-version"]')).toHaveText('ZVEI Digital Nameplate 1.0')
  await expect(v1.locator('[data-test="manufacturer"]')).toContainText('Customer service')
})

test('shows the contacts with roles, channels and search, and saves one as vCard', async ({ page }) => {
  const frame = await openSubmodel(page, 'Contacts', shell, contacts, '[data-test="contact"]')
  await expect(frame.locator('[data-test="contact"]')).toHaveCount(4)
  await expect(frame.locator('[data-test="contact-name"]')).toHaveText(['Ms Dr. Jane Q. Doe', 'Example Drives GmbH', 'Alex Kim', 'Example Drives Inc.'])
  await expect(frame.locator('[data-test="contact-role"]')).toHaveText(['Technical contact', 'Commercial contact', 'Hazardous goods contact', 'Other contact'])

  const jane = frame.locator('[data-test="contact"]').first()
  await expect(jane.locator('[data-test="contact-organization"]')).toHaveText('Example Drives GmbH · Research and development')
  await expect(jane.locator('[data-test="detail-link"]').filter({ hasText: '+49 (0)631 123456-21' })).toBeVisible()
  await expect(jane).toContainText('Mon–Thu 9:00–16:00 CET')
  await expect(jane).toContainText('German, English')
  await expect(jane.locator('[data-test="detail-type"]').filter({ hasText: 'Video call' })).toBeVisible()

  // An email address opens in the mail app; Studio's page stays where it is.
  const url = page.url()
  await clickIn(contactsFrame(page), jane.locator('[data-test="detail-link"]').filter({ hasText: 'jane.doe@example.com' }))
  expect(page.url()).toBe(url)

  // The search finds contacts by any text, also the translated role.
  await clickIn(contactsFrame(page), frame.locator('[data-test="contact-search"] input'))
  await frame.locator('[data-test="contact-search"] input').fill('hazardous')
  await expect(frame.locator('[data-test="contact-name"]')).toHaveText(['Alex Kim'])
  await expect(frame.locator('[data-test="contact-count"]')).toHaveText('1 of 4 contacts')
  await frame.locator('[data-test="contact-search"] input').fill('nobody')
  await expect(frame.locator('[data-test="no-match"]')).toBeVisible()
  await frame.locator('[data-test="contact-search"] input').fill('')
  await expect(frame.locator('[data-test="contact"]')).toHaveCount(4)

  const download = page.waitForEvent('download')
  await clickIn(contactsFrame(page), jane.locator('[data-test="save-vcard"]'))
  const vcard = await download
  expect(vcard.suggestedFilename()).toBe('Ms Dr. Jane Q. Doe.vcf')
})

test('changes a contact\'s value in place in edit mode', async ({ page, request }) => {
  const frame = await openSubmodel(page, 'Contacts', shell, contacts, '[data-test="contact"]')
  await expect(frame.getByRole('button', { name: 'Edit Department' })).toHaveCount(0)
  await setMode(page, 'Edit')

  const jane = frame.locator('[data-test="contact"]').first()
  try {
    await clickIn(contactsFrame(page), jane.getByRole('button', { name: 'Edit Department' }))
    await expect(jane.locator('[data-test="edit-field"]')).toContainText('Language: en')
    await jane.getByRole('textbox', { name: 'Department' }).fill('Drive engineering')
    await clickIn(contactsFrame(page), jane.getByRole('button', { name: 'Save' }))
    await expect(frame.locator('[data-test="notice"]')).toContainText('Department saved.')
    await expect(jane.locator('[data-field="ContactInformation__00__.Department"]')).toContainText('Drive engineering')
    await expect(page.getByText('Contacts: Department saved.')).toBeVisible()
  } finally {
    // The German text stayed; the English one goes back as it was.
    const response = await request.get(`http://localhost:18081/submodels/${key(contacts)}/submodel-elements/ContactInformation__00__.Department`)
    const element = await response.json() as { value: Array<{ language: string, text: string }> }
    expect(element.value.find(entry => entry.language === 'de')?.text).toBe('Forschung und Entwicklung')
    await request.patch(`http://localhost:18081/submodels/${key(contacts)}/submodel-elements/ContactInformation__00__.Department/$value`, {
      data: JSON.stringify([{ en: 'Research and development' }, { de: 'Forschung und Entwicklung' }]),
      headers: { 'Content-Type': 'application/json' },
    })
  }
})

test('opens full screen with the search kept, from its own button where Studio shows none', async ({ page }) => {
  const frame = await openSubmodel(page, 'Contacts', shell, contacts, '[data-test="contact"]')
  await clickIn(contactsFrame(page), frame.locator('[data-test="contact-search"] input'))
  await frame.locator('[data-test="contact-search"] input').fill('chicago')
  await expect(frame.locator('[data-test="contact"]')).toHaveCount(1)
  await clickIn(contactsFrame(page), frame.locator('[data-test="contacts-fullscreen"]'))
  const dialogFrame = page.frameLocator('.v-dialog iframe[title="App: Contacts"]')
  await expect(dialogFrame.locator('[data-test="contact-name"]')).toHaveText(['Example Drives Inc.'], { timeout: 30_000 })
  await expect(dialogFrame.locator('[data-test="contacts-fullscreen"]')).toHaveCount(0)
  await page.locator('[data-test="app-fullscreen-close"]').click()
  await expect(page.locator('.v-dialog')).toBeHidden()
})
