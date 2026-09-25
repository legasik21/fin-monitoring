import { Router } from 'express';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import db from '../db.js';
import { categories, users } from '../schema.js';
import { isCategoryKind } from '../lib/categories.js';
import { todayStr } from '../lib/dates.js';
import { parseAmount } from '../lib/money.js';
import { hashQuickAddKey } from '../lib/quickAddKey.js';
import {
  HttpError,
  MONEY_ERROR,
  bodyOf,
  insertTransaction,
  parseId,
  parseNote,
  rangeTotals,
  route,
  undoLastQuickAdd,
  withUserLock,
} from '../lib/ledger.js';
import { serializeTotals, serializeTransaction } from '../serialize.js';

// Apple Shortcuts entry point. Mounted WITHOUT the JWT guard: each request is
// authenticated by the caller's personal `X-API-Key`, whose sha256 is the only
// thing stored (users.quick_add_key_hash). Keys are 256-bit random, so an exact
// hash lookup is safe — there is nothing to brute-force or time.
const router = Router();

const UNKNOWN_CATEGORY = 'Невідома категорія';

async function requireQuickAddKey(req, res, next) {
  const key = req.get('X-API-Key');
  if (!key) return res.status(401).json({ error: 'Невірний ключ API' });
  const [user] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.quick_add_key_hash, hashQuickAddKey(key)))
    .limit(1);
  if (!user) return res.status(401).json({ error: 'Невірний ключ API' });
  req.userId = user.id;
  next();
}

/**
 * Resolve the Shortcut's `category` to one of the caller's ACTIVE categories:
 * a JSON number is an id; a string is a name (trimmed, case-insensitive via
 * Postgres lower(), the same folding as the unique index), falling back to an id
 * when it is all digits. `kind` narrows both matches. Anything else — unknown,
 * archived, foreign, out of range — is one 400, so ids of other users are not
 * distinguishable from missing ones.
 */
async function resolveCategory(tx, userId, raw, kind) {
  const scope = [eq(categories.user_id, userId), isNull(categories.archived_at)];
  if (kind) scope.push(eq(categories.kind, kind));

  const byId = async (value) => {
    const id = parseId(value);
    if (!id) throw new HttpError(400, UNKNOWN_CATEGORY);
    const [row] = await tx
      .select()
      .from(categories)
      .where(and(...scope, eq(categories.id, id)))
      .limit(1);
    if (!row) throw new HttpError(400, UNKNOWN_CATEGORY);
    return row;
  };

  if (typeof raw === 'number') return byId(raw);
  if (typeof raw !== 'string' || !raw.trim()) throw new HttpError(400, UNKNOWN_CATEGORY);

  const name = raw.trim();
  const matches = await tx
    .select()
    .from(categories)
    .where(and(...scope, sql`lower(${categories.name}) = lower(${name}::text)`))
    .orderBy(asc(categories.id));
  // Active names are unique per kind, so two matches = one income + one expense.
  if (matches.length > 1) {
    throw new HttpError(400, 'Неоднозначна категорія: вкажіть kind (income або expense)');
  }
  if (matches.length === 1) return matches[0];
  if (/^\d+$/.test(name)) return byId(name);
  throw new HttpError(400, UNKNOWN_CATEGORY);
}

// POST /api/quick-add  { category, amount, note?, kind? }
// Adds a quick_add entry dated today (reopening today if it was closed) and
// answers with today's totals.
router.post(
  '/',
  requireQuickAddKey,
  route(async (req, res) => {
    const userId = req.userId;
    const body = bodyOf(req);

    let kind = null;
    if (body.kind !== undefined && body.kind !== null) {
      if (!isCategoryKind(body.kind)) throw new HttpError(400, 'Невірний тип категорії');
      kind = body.kind;
    }
    const amount = parseAmount(body.amount);
    if (!amount) throw new HttpError(400, MONEY_ERROR);
    const note = parseNote(body.note);
    if (note.error) throw new HttpError(400, note.error);

    const date = todayStr();
    const { row, totals } = await withUserLock(userId, async (tx) => {
      // Resolved inside the lock so the category can't be archived mid-request.
      const category = await resolveCategory(tx, userId, body.category, kind);
      const inserted = await insertTransaction(tx, {
        userId,
        category,
        date,
        amount,
        note: note.value,
        source: 'quick_add',
      });
      return { row: inserted, totals: await rangeTotals(tx, userId, date, date) };
    });

    res.json({
      ok: true,
      date,
      transaction: serializeTransaction(row),
      totals: serializeTotals(totals),
    });
  })
);

// DELETE /api/quick-add/last — undo the key owner's latest quick-add of today.
router.delete(
  '/last',
  requireQuickAddKey,
  route(async (req, res) => {
    const result = await undoLastQuickAdd(req.userId);
    if (!result) throw new HttpError(404, 'Немає швидких записів за сьогодні');
    res.json({ ok: true, ...result });
  })
);

export default router;
