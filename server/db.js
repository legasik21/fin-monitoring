import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// DB_PATH from .env is resolved relative to the project root (one level above
// /server) so the database file lands next to the project as documented.
const rawPath = process.env.DB_PATH || './database.sqlite';
const dbPath = path.isAbsolute(rawPath)
  ? rawPath
  : path.resolve(__dirname, '..', rawPath);

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Auto-create the schema on first start.
db.exec(`
  CREATE TABLE IF NOT EXISTS days (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT UNIQUE NOT NULL,            -- format: YYYY-MM-DD
    income_main REAL DEFAULT 0,           -- main income
    income_tips REAL DEFAULT 0,           -- tips / bonuses
    expense_food_out REAL DEFAULT 0,      -- food outside home
    expense_food_market REAL DEFAULT 0,   -- groceries
    expense_no_reason REAL DEFAULT 0,     -- impulse / misc spending
    expense_gas REAL DEFAULT 0,           -- fuel / gas
    is_closed INTEGER DEFAULT 0,          -- 0 = open, 1 = day finalized
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );
`);

console.log(`[db] SQLite ready at ${dbPath}`);

export default db;
