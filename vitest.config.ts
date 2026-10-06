import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const root = fileURLToPath(new URL('.', import.meta.url))

// Unit tests cover framework-independent modules (server/lib, shared). Tests
// that need the local test environment live in `test/integration` and run
// only when STUDIO_TESTENV=1 (`pnpm test:integration`).
export default defineConfig({
  resolve: {
    alias: {
      '#shared': `${root}shared`,
      '~~': root.replace(/\/$/, ''),
    },
  },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    testTimeout: 30_000,
    server: {
      deps: {
        // Its ESM build uses extensionless imports that plain Node cannot load.
        inline: ['@aas-core-works/aas-core3.1-typescript'],
      },
    },
  },
})
