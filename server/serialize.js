import { toMoney } from './lib/money.js';

// Row → JSON mappers for the shared shapes in docs/API.md. Postgres hands back
// numeric(14,2) as strings, dates as 'YYYY-MM-DD' strings and booleans as real
// booleans; the client contract wants money as JS numbers, is_closed as 0 | 1
// and timestamps as ISO strings, so every conversion happens here, once.

/** Date (drizzle timestamp) or raw Postgres timestamptz string → ISO string. */
const toIso = (value) =>
  value === null || value === undefined
    ? null
    : (value instanceof Date ? value : new Date(value)).toISOString();

/** 'YYYY-MM-DD' — drizzle `date` columns are mode:'string' already. */
const toDate = (value) => String(value).slice(0, 10);

export function serializeCategory(row) {
  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    color: row.color,
    sort_order: row.sort_order,
    archived: row.archived_at !== null && row.archived_at !== undefined,
    archived_at: toIso(row.archived_at),
    created_at: toIso(row.created_at),
  };
}

/** The compact category label embedded in transactions and stats. */
export function serializeCategoryRef(row) {
  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    color: row.color,
    archived: row.archived_at !== null && row.archived_at !== undefined,
  };
}

/** `category` defaults to the nested object the ledger selects alongside the row. */
export function serializeTransaction(row, category = row.category) {
  return {
    id: row.id,
    date: toDate(row.date),
    amount: toMoney(row.amount),
    note: row.note ?? null,
    source: row.source,
    created_at: toIso(row.created_at),
    category: serializeCategoryRef(category),
  };
}

/** Today's (or any day's) income / expenses / balance, already summed in SQL. */
export function serializeTotals(row) {
  return {
    income: toMoney(row?.income),
    expenses: toMoney(row?.expenses),
    balance: toMoney(row?.balance),
  };
}

// is_closed stays 0 | 1: the client compares `day.is_closed === 1` (legacy contract)
// while the DB stores a real boolean.
export function serializeDaySummary(row) {
  return {
    id: row.id,
    date: toDate(row.date),
    is_closed: row.is_closed ? 1 : 0,
    ...serializeTotals(row),
    created_at: toIso(row.created_at),
    updated_at: toIso(row.updated_at),
  };
}

/** Adds the derived `percent` (0–100, 1 decimal) the client renders the progress bar from. */
export function serializeGoal(row) {
  const target = toMoney(row.target_amount);
  const current = toMoney(row.current_amount);
  const percent = target > 0 ? Math.min(100, Math.round((current / target) * 1000) / 10) : 0;
  return {
    id: row.id,
    title: row.title,
    target_amount: target,
    current_amount: current,
    // Generated column in Postgres — read, never written by the app.
    achieved: Boolean(row.achieved),
    percent,
    created_at: toIso(row.created_at),
  };
}
