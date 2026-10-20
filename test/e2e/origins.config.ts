import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { defineConfig, devices } from '@playwright/test'

// End-to-end tests of app origins (ADR 0045) in the hosted production build,
// without the test environment: two Studios without login on PGlite, one
// with an origin per installation and one with a shared apps origin. Run
// `pnpm build` first. The tests serve the "third-party" pages themselves.
const servers = [
  { name: 'installation-origins', port: 3400, appsUrl: 'http://{installation}.apps.localhost:3400' },
  { name: 'shared-origin', port: 3401, appsUrl: 'http://apps.localhost:3401' },
]

export default defineConfig({
  testDir: 'origins',
  timeout: 60_000,
  workers: 1,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never', outputFolder: '../../playwright-report/origins' }]] : 'list',
  outputDir: '../../test-results/origins',
  use: { trace: 'retain-on-failure' },
  projects: servers.map(server => ({
    name: server.name,
    use: { ...devices['Desktop Chrome'], baseURL: `http://localhost:${server.port}` },
  })),
  webServer: servers.map(server => ({
    command: 'node .output/server/index.mjs',
    cwd: '../..',
    url: `http://localhost:${server.port}/api/studio/v1/context`,
    timeout: 60_000,
    reuseExistingServer: false,
    env: {
      NITRO_PORT: String(server.port),
      STUDIO_PUBLIC_URL: `http://localhost:${server.port}`,
      STUDIO_DATA_DIR: join(tmpdir(), `studio-e2e-${server.name}-${process.pid}`),
      STUDIO_DATA_KEY: 'dGVzdC1vbmx5LWRhdGEta2V5LWZvci1sb2NhbC1kZXY',
      STUDIO_AUTH_MODE: 'none',
      STUDIO_ANONYMOUS_ROLES: 'studio-admin',
      STUDIO_APPS_URL: server.appsUrl,
      // Loopback origins (embed.localhost) need developer mode.
      STUDIO_APPS_ALLOW_UNSIGNED: 'true',
    },
  })),
})
