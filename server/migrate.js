import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import db, { pool } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsFolder = path.join(__dirname, 'drizzle');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Apply pending Drizzle migrations. Retries a few times so a just-started
 * Postgres (depends_on: service_healthy still settling) doesn't crash boot.
 */
export async function runMigrations() {
  let lastErr;
  for (let attempt = 1; attempt <= 10; attempt++) {
    try {
      await migrate(db, { migrationsFolder });
      console.log('[db] migrations applied');
      return;
    } catch (err) {
      lastErr = err;
      console.warn(`[db] migration attempt ${attempt} failed: ${err.message}`);
      await sleep(2000);
    }
  }
  throw lastErr;
}

// Allow running standalone: `node migrate.js`
if (import.meta.url === `file://${process.argv[1]}`) {
  runMigrations()
    .then(() => pool.end())
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('[db] migration failed:', err);
      process.exit(1);
    });
}
