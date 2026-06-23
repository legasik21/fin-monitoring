import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from './schema.js';

const { Pool } = pg;

// DATABASE_URL is provided at runtime by docker compose (or server/.env in dev).
const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('[db] DATABASE_URL is not set');
}

export const pool = new Pool({
  connectionString,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

// Without this listener, an idle-client disconnect emits an unhandled 'error'
// event that crashes the Node process.
pool.on('error', (err) => {
  console.error('[db] unexpected idle client error:', err.message);
});

export const db = drizzle(pool, { schema });

console.log('[db] Postgres pool ready');

export default db;
