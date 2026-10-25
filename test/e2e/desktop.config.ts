import { defineConfig } from '@playwright/test'

// End-to-end tests of the packaged desktop app (electron-builder --dir).
// Build it with `pnpm build:electron:app && pnpm exec electron-builder --dir`.
// CI runs the files in two shards of about the same duration
// (STUDIO_E2E_SHARD): the container flow, and every other file.
const shard = process.env.STUDIO_E2E_SHARD
if (shard !== undefined && shard !== 'containers' && shard !== 'other') {
  throw new Error('STUDIO_E2E_SHARD must be containers or other.')
}
const containers = /containers\.spec/

export default defineConfig({
  testDir: 'desktop',
  ...(shard === 'containers' ? { testMatch: containers } : {}),
  ...(shard === 'other' ? { testIgnore: containers } : {}),
  timeout: 90_000,
  workers: 1,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never', outputFolder: '../../playwright-report/desktop' }]] : 'list',
  outputDir: '../../test-results/desktop',
  use: { trace: 'retain-on-failure' },
})
