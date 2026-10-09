import type { ElectronApplication, Page } from '@playwright/test'
import { copyFile, mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron as electron, expect, test } from '@playwright/test'
import { strFromU8, unzipSync } from 'fflate'

// MVP-2 definition of done 5 in the packaged desktop app: open a local AASX
// package, edit, save, save as, and be asked before losing unsaved changes.
// Native dialogs are replaced in the main process; everything else is real.

const root = fileURLToPath(new URL('../../..', import.meta.url))
const fixture = join(root, 'test-setup/fixtures/open/IESEDriveMotorDM3000.aasx')

function executablePath (): string {
  if (process.env.STUDIO_E2E_EXECUTABLE) {
    return process.env.STUDIO_E2E_EXECUTABLE
  }
  switch (process.platform) {
    case 'darwin': {
      return join(root, `dist/mac${process.arch === 'arm64' ? '-arm64' : ''}/BaSyx Studio.app/Contents/MacOS/BaSyx Studio`)
    }
    case 'win32': {
      return join(root, 'dist/win-unpacked/BaSyx Studio.exe')
    }
    default: {
      return join(root, 'dist/linux-unpacked/studio')
    }
  }
}

async function contentXml (path: string): Promise<string> {
  const entries = unzipSync(new Uint8Array(await readFile(path)), { filter: entry => entry.name.endsWith('.xml') && entry.name.startsWith('aasx/') })
  return Object.values(entries).map(bytes => strFromU8(bytes)).join('\n')
}

let app: ElectronApplication
let window: Page
let directory: string

test.beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'studio-e2e-'))
  app = await electron.launch({
    executablePath: executablePath(),
    // macOS: an in-memory keychain, so test runs never prompt for Keychain access.
    // Linux: the Secret Service (CI unlocks a gnome-keyring), never plain text.
    args: process.platform === 'darwin' ? ['--use-mock-keychain'] : (process.platform === 'linux' ? ['--password-store=gnome-libsecret'] : []),
    env: { ...process.env, STUDIO_USER_DATA_DIR: join(directory, 'user-data') },
  })
  window = await app.firstWindow()
  await expect(window.getByRole('heading', { name: 'AAS targets' })).toBeVisible({ timeout: 30_000 })
})

test.afterEach(async () => {
  // Discard whatever a test left unsaved, so quitting is never blocked by a dialog.
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBox = (async () => ({ response: 1, checkboxChecked: false })) as typeof dialog.showMessageBox
  })
  await app.close()
})

async function chooseFiles (open: string, save?: string) {
  await app.evaluate(({ dialog }, paths) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [paths.open] })) as typeof dialog.showOpenDialog
    if (paths.save) {
      dialog.showSaveDialog = (async () => ({ canceled: false, filePath: paths.save })) as typeof dialog.showSaveDialog
    }
  }, { open, save })
}

/** Edits SerialNumber; `select` clicks it in the tree (a second click would deselect it). */
async function editSerialNumber (value: string, select = true) {
  if (select) {
    await window.getByRole('tree').getByText('SerialNumber', { exact: true }).click()
  }
  const field = window.getByRole('textbox').first()
  await field.fill(value)
  await window.getByRole('button', { name: 'Apply' }).click()
  await expect(window.getByText('Applied. Save the package to keep the change.')).toBeVisible()
  await expect(window.getByText('Unsaved changes', { exact: true })).toBeVisible()
}

async function openPackage (path: string) {
  await window.getByRole('button', { name: 'Open AASX file' }).click()
  await expect(window).toHaveURL(/\/targets\/ws-/)
  await window.getByText('Servo Motor DM-3000 (Fraunhofer IESE)').click()
  await window.getByText('Nameplate', { exact: true }).click()
  await expect(window.getByRole('tree').getByText('SerialNumber', { exact: true })).toBeVisible()
  return path
}

test('opens a package, edits a value, saves and saves as', async () => {
  const path = join(directory, 'motor.aasx')
  const copy = join(directory, 'motor-copy.aasx')
  await copyFile(fixture, path)
  await chooseFiles(path, copy)
  await openPackage(path)

  await editSerialNumber('SN-E2E-0001')
  await window.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(window.getByText('Saved', { exact: true })).toBeVisible()
  expect(await contentXml(path)).toContain('SN-E2E-0001')

  await editSerialNumber('SN-E2E-0002', false)
  await window.getByRole('button', { name: 'Save as…' }).click()
  await expect(window.getByText('motor-copy.aasx').first()).toBeVisible()
  expect(await contentXml(copy)).toContain('SN-E2E-0002')
  // Save As leaves the original file as it was.
  expect(await contentXml(path)).not.toContain('SN-E2E-0002')
})

test('asks before closing a package or the window with unsaved changes', async () => {
  const path = join(directory, 'unsaved.aasx')
  await copyFile(fixture, path)
  await chooseFiles(path)
  await openPackage(path)
  await editSerialNumber('SN-E2E-UNSAVED')

  // Closing the package in the app asks first.
  await window.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(window.getByText('Close unsaved.aasx?')).toBeVisible()
  await window.getByRole('button', { name: 'Cancel' }).click()

  // Closing the window asks the main process, which asks the user.
  await app.evaluate(({ dialog }) => {
    const calls: unknown[] = []
    Object.assign(globalThis, { studioE2eMessageBoxes: calls })
    dialog.showMessageBox = (async (...args: unknown[]) => {
      calls.push(args.at(-1))
      return { response: 0, checkboxChecked: false }
    }) as typeof dialog.showMessageBox
  })
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.close())
  await expect.poll(() => app.evaluate(() => (globalThis as { studioE2eMessageBoxes?: unknown[] }).studioE2eMessageBoxes?.length ?? 0)).toBe(1)
  // "Cancel" keeps the window open with the unsaved change.
  await expect(window.getByText('Unsaved changes', { exact: true })).toBeVisible()
  expect(await contentXml(path)).not.toContain('SN-E2E-UNSAVED')
})
