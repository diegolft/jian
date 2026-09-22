import { defineConfig } from 'drizzle-kit';

// The SQL under migrations/ is what ships: the gateway applies it on startup and never asks
// drizzle-kit at runtime. Regenerate with `make db-migration`.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/storage/schema.ts',
  out: './migrations',
  casing: 'snake_case',
  strict: true,
});
