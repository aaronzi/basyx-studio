import { defineConfig } from 'drizzle-kit'

// Generates SQL migrations only (`pnpm db:generate`). Migrations are applied by
// the Studio Service at startup on PostgreSQL and PGlite alike (ADR 0011).
export default defineConfig({
  dialect: 'postgresql',
  schema: './server/database/schema.ts',
  out: './server/database/migrations',
})
