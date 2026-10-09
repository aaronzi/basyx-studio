import { defineConfig } from '@playwright/test'

// End-to-end tests of the packaged desktop app (electron-builder --dir).
// Build it with `pnpm build:electron:app && pnpm exec electron-builder --dir`.
export default defineConfig({
  testDir: 'desktop',
  timeout: 90_000,
  workers: 1,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never', outputFolder: '../../playwright-report/desktop' }]] : 'list',
  outputDir: '../../test-results/desktop',
  use: { trace: 'retain-on-failure' },
})
