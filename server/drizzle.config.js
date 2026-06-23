import { defineConfig } from 'drizzle-kit';

// Used by `drizzle-kit generate` to emit SQL migrations from schema.js.
// `generate` diffs the schema against ./drizzle and needs no live DB; the URL
// is only consulted by push/migrate/studio, so a fallback is fine here.
export default defineConfig({
  schema: './schema.js',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL || 'postgres://fin:fin@localhost:5432/fin_monitoring',
  },
});
