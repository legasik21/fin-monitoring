import { and, asc, between, desc, eq, sql } from 'drizzle-orm';
import db from '../db.js';
import { categories, days, transactions } from '../schema.js';
import { lockUser } from './categories.js';
import { todayStr } from './dates.js';
import { serializeTotals, serializeTransaction } from '../serialize.js';

// The transaction ledger: day rows, ledger writes and the SQL sums everything
// else (day pages, quick-add totals, stats) is computed from. Plus the few
// request helpers the data routers share, so every router validates ids, notes
// and error responses the same way.

// ---- request helpers -------------------------------------------------------

export const MONEY_ERROR = 'Сума має бути додатнім числом';
export const DATE_ERROR = 'Невірний формат дати (очікується YYYY-MM-DD)';
export const ID_ERROR = 'Невірний ідентифікатор';
export const NOTE_ERROR = 'Нотатка — до 200 символів';
export const NOTE_MAX = 200;

// Serial ids are int4; anything larger would make Postgres raise instead of
// simply not matching, so it is rejected up front as a 400.
const MAX_ID = 2147483647;

/** A 4xx response thrown from inside a handler (or a DB transaction, rolling it back). */
export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.httpStatus = status;
  }
}

/**
 * Wrap an async handler so a thrown HttpError becomes its `{ error }` response.
 * Anything else still propagates to the central 500 handler (Express 5 forwards
 * rejected promises), so unexpected failures are never swallowed.
 */
export const route = (handler) => async (req, res) => {
  try {
    await handler(req, res);
  } catch (err) {
    if (err instanceof HttpError) return res.status(err.httpStatus).json({ error: err.message });
    throw err;
  }
};

/** The JSON body as a plain object (express.json leaves it undefined without a body). */
export const bodyOf = (req) =>
  req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};

/** Integer id in 1..2147483647 from a URL segment or JSON value; null otherwise. */
export function parseId(raw) {
  let n;
  if (typeof raw === 'number') n = raw;
  else if (typeof raw === 'string' && /^\d{1,10}$/.test(raw)) n = Number(raw);
  else return null;
  return Number.isInteger(n) && n >= 1 && n <= MAX_ID ? n : null;
}

/**
 * Optional note: string or null; trimmed, empty → null; ≤ 200 code points (so it
 * matches Postgres char_length()). Returns { value } or { error }.
 */
export function parseNote(raw) {
  if (raw === undefined || raw === null) return { value: null };
  if (typeof raw !== 'string') return { error: NOTE_ERROR };
  const note = raw.trim();
  if (!note) return { value: null };
  if ([...note].length > NOTE_MAX) return { error: NOTE_ERROR };
  return { value: note };
}

/** The node-pg error (with `.code`, `.constraint`) behind a drizzle-wrapped one, or null. */
export function pgError(err) {
  for (let e = err, depth = 0; e && depth < 5; e = e.cause, depth++) {
    if (typeof e.code === 'string' && /^[0-9A-Z]{5}$/.test(e.code)) return e;
  }
  return null;
}

// ---- transactions ---------------------------------------------------------

/**
 * Run `fn(tx)` in ONE DB transaction holding the user's row lock. Every ledger
 * and category write goes through here, so a user's concurrent requests are
 * serialised: check-then-write (active category, limits) cannot interleave, and
 * a day row can't be cleaned up while another request is adding to it.
 */
export function withUserLock(userId, fn) {
  return db.transaction(async (tx) => {
    await lockUser(tx, userId);
    return fn(tx);
  });
}

/** Several reads that must agree with each other (e.g. stats totals vs. chart). */
export function readSnapshot(fn) {
  return db.transaction(fn, { isolationLevel: 'repeatable read', accessMode: 'read only' });
}

// ---- day rows ------------------------------------------------------------
// The FK transactions(user_id, date) → days(user_id, date) makes the order
// mandatory: the day row is upserted BEFORE a transaction is inserted, and only
// removed once its last transaction is gone. days has no updated_at trigger, so
// every UPDATE sets it explicitly.

/** Create the day open, or reopen it: adding an entry to a closed day reopens it. */
export async function openDay(tx, userId, date) {
  await tx.execute(sql`
    INSERT INTO days (user_id, date, is_closed) VALUES (${userId}, ${date}, false)
    ON CONFLICT (user_id, date) DO UPDATE SET is_closed = false, updated_at = now()`);
}

/** Close the day, creating it (closed) when nothing was recorded yet. */
export async function closeDay(tx, userId, date) {
  await tx.execute(sql`
    INSERT INTO days (user_id, date, is_closed) VALUES (${userId}, ${date}, true)
    ON CONFLICT (user_id, date) DO UPDATE SET is_closed = true, updated_at = now()`);
}

/**
 * After deleting a transaction: drop the day row if it is open and now empty, so
 * an undone quick-add leaves no trace. A closed empty day stays recorded.
 */
export async function cleanupDay(tx, userId, date) {
  await tx.execute(sql`
    DELETE FROM days WHERE user_id = ${userId} AND date = ${date} AND is_closed = false
      AND NOT EXISTS (SELECT 1 FROM transactions WHERE user_id = ${userId} AND date = ${date})`);
}

// ---- sums (always in SQL, never accumulated in JS) -------------------------
// numeric sums stay exact: 0.10 + 0.20 comes back as "0.30". Factories, so each
// query gets its own SQL objects.

export const categoryJoin = () =>
  and(eq(categories.id, transactions.category_id), eq(categories.user_id, transactions.user_id));
export const incomeSum = () =>
  sql`coalesce(sum(${transactions.amount}) filter (where ${categories.kind} = 'income'), 0)`;
export const expenseSum = () =>
  sql`coalesce(sum(${transactions.amount}) filter (where ${categories.kind} = 'expense'), 0)`;
const totalsFields = () => ({
  income: incomeSum(),
  expenses: expenseSum(),
  balance: sql`${incomeSum()} - ${expenseSum()}`,
});

/**
 * Day rows with their income / expenses / balance. Options: `from` / `to`
 * (inclusive dates), `order` 'desc' (newest first, default) or 'asc'.
 * Money fields are numeric strings — serialize with toMoney.
 */
export function queryDaySummaries(q, userId, { from, to, order = 'desc' } = {}) {
  const where = [eq(days.user_id, userId)];
  if (from && to) where.push(between(days.date, from, to));
  return q
    .select({
      id: days.id,
      date: days.date,
      is_closed: days.is_closed,
      created_at: days.created_at,
      updated_at: days.updated_at,
      ...totalsFields(),
    })
    .from(days)
    .leftJoin(
      transactions,
      and(eq(transactions.user_id, days.user_id), eq(transactions.date, days.date))
    )
    .leftJoin(categories, categoryJoin())
    .where(and(...where))
    .groupBy(days.id)
    .orderBy(order === 'asc' ? asc(days.date) : desc(days.date));
}

/** One day's summary row, or null when the day is not recorded. */
export async function getDaySummary(q, userId, date) {
  const [row] = await queryDaySummaries(q, userId, { from: date, to: date });
  return row ?? null;
}

/** { income, expenses, balance } over an inclusive date range (zeros when empty). */
export async function rangeTotals(q, userId, from, to) {
  const [row] = await q
    .select(totalsFields())
    .from(transactions)
    .innerJoin(categories, categoryJoin())
    .where(and(eq(transactions.user_id, userId), between(transactions.date, from, to)));
  return row;
}

// ---- transaction rows ------------------------------------------------------

// A transaction plus the category label it is shown with (archived or not).
const transactionFields = () => ({
  id: transactions.id,
  date: transactions.date,
  amount: transactions.amount,
  note: transactions.note,
  source: transactions.source,
  created_at: transactions.created_at,
  category: {
    id: categories.id,
    kind: categories.kind,
    name: categories.name,
    color: categories.color,
    archived_at: categories.archived_at,
  },
});

const selectTransactions = (q) =>
  q.select(transactionFields()).from(transactions).innerJoin(categories, categoryJoin());

/** The caller's transaction (with its category), or null — foreign ids look missing. */
export async function getTransaction(q, userId, id) {
  const [row] = await selectTransactions(q)
    .where(and(eq(transactions.id, id), eq(transactions.user_id, userId)))
    .limit(1);
  return row ?? null;
}

/** A day's entries, oldest first. */
export function listDayTransactions(q, userId, date) {
  return selectTransactions(q)
    .where(and(eq(transactions.user_id, userId), eq(transactions.date, date)))
    .orderBy(asc(transactions.created_at), asc(transactions.id));
}

/** The caller's category (active or archived), or null. */
export async function findCategory(q, userId, id) {
  const [row] = await q
    .select()
    .from(categories)
    .where(and(eq(categories.id, id), eq(categories.user_id, userId)))
    .limit(1);
  return row ?? null;
}

/**
 * Insert an entry inside a withUserLock transaction: (re)open its day first
 * (FK), then the row. `category` must already be checked as the caller's active one.
 */
export async function insertTransaction(tx, { userId, category, date, amount, note, source }) {
  await openDay(tx, userId, date);
  const [row] = await tx
    .insert(transactions)
    .values({ user_id: userId, category_id: category.id, date, amount, note, source })
    .returning();
  return { ...row, category };
}

/**
 * Remove the user's most recent quick-add entry of today (created_at desc, id
 * desc). Shared by DELETE /api/quick-add/last (API key) and
 * DELETE /api/transactions/last-quick-add (in-app undo). Returns
 * { date, removed: Transaction, totals: Totals } or null when there is none.
 */
export async function undoLastQuickAdd(userId) {
  const date = todayStr();
  return withUserLock(userId, async (tx) => {
    const [last] = await selectTransactions(tx)
      .where(
        and(
          eq(transactions.user_id, userId),
          eq(transactions.date, date),
          eq(transactions.source, 'quick_add')
        )
      )
      .orderBy(desc(transactions.created_at), desc(transactions.id))
      .limit(1);
    if (!last) return null;

    await tx
      .delete(transactions)
      .where(and(eq(transactions.id, last.id), eq(transactions.user_id, userId)));
    await cleanupDay(tx, userId, date);
    const totals = await rangeTotals(tx, userId, date, date);
    return { date, removed: serializeTransaction(last), totals: serializeTotals(totals) };
  });
}
