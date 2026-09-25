import { Router } from 'express';
import { and, eq } from 'drizzle-orm';
import db from '../db.js';
import { transactions } from '../schema.js';
import { parseAmount } from '../lib/money.js';
import { isValidDateStr, todayStr } from '../lib/dates.js';
import {
  DATE_ERROR,
  HttpError,
  ID_ERROR,
  MONEY_ERROR,
  bodyOf,
  cleanupDay,
  findCategory,
  getDaySummary,
  getTransaction,
  insertTransaction,
  parseId,
  parseNote,
  route,
  undoLastQuickAdd,
  withUserLock,
} from '../lib/ledger.js';
import { serializeDaySummary, serializeTransaction } from '../serialize.js';

const router = Router();

const NOT_FOUND = 'Запис не знайдено';

/**
 * The caller's ACTIVE category for a new/changed entry. Runs inside the user
 * lock, so the category cannot be archived between this check and the write.
 */
async function activeCategory(tx, userId, id) {
  const category = await findCategory(tx, userId, id);
  if (!category) throw new HttpError(404, 'Категорію не знайдено');
  if (category.archived_at) throw new HttpError(400, 'Категорію архівовано');
  return category;
}

// DELETE /api/transactions/last-quick-add — in-app undo of today's latest
// quick-add (same logic as DELETE /api/quick-add/last). Registered before /:id.
router.delete(
  '/last-quick-add',
  route(async (req, res) => {
    const result = await undoLastQuickAdd(req.userId);
    if (!result) throw new HttpError(404, 'Немає швидких записів за сьогодні');
    res.json({ ok: true, ...result });
  })
);

// GET /api/transactions/:id
router.get(
  '/:id',
  route(async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) throw new HttpError(400, ID_ERROR);
    const row = await getTransaction(db, req.userId, id);
    if (!row) throw new HttpError(404, NOT_FOUND);
    res.json(serializeTransaction(row));
  })
);

// POST /api/transactions  { category_id, amount, date?, note? }
// Adds an entry and (re)opens its day, even a closed one.
router.post(
  '/',
  route(async (req, res) => {
    const userId = req.userId;
    const body = bodyOf(req);

    const categoryId = parseId(body.category_id);
    if (!categoryId) throw new HttpError(400, ID_ERROR);
    const amount = parseAmount(body.amount);
    if (!amount) throw new HttpError(400, MONEY_ERROR);
    const date = body.date === undefined || body.date === null ? todayStr() : body.date;
    if (!isValidDateStr(date)) throw new HttpError(400, DATE_ERROR);
    const note = parseNote(body.note);
    if (note.error) throw new HttpError(400, note.error);

    const { row, day } = await withUserLock(userId, async (tx) => {
      const category = await activeCategory(tx, userId, categoryId);
      const inserted = await insertTransaction(tx, {
        userId,
        category,
        date,
        amount,
        note: note.value,
        source: 'manual',
      });
      return { row: inserted, day: await getDaySummary(tx, userId, date) };
    });

    res.status(201).json({ transaction: serializeTransaction(row), day: serializeDaySummary(day) });
  })
);

// PATCH /api/transactions/:id  any of { category_id, amount, note }
// The date is fixed (moving an entry would mean moving it between day rows);
// is_closed is left alone.
router.patch(
  '/:id',
  route(async (req, res) => {
    const userId = req.userId;
    const id = parseId(req.params.id);
    if (!id) throw new HttpError(400, ID_ERROR);

    const body = bodyOf(req);
    const has = (key) => body[key] !== undefined;
    if (!has('category_id') && !has('amount') && !has('note')) {
      throw new HttpError(400, 'Немає змін');
    }

    const set = {};
    let categoryId = null;
    if (has('category_id')) {
      categoryId = parseId(body.category_id);
      if (!categoryId) throw new HttpError(400, ID_ERROR);
    }
    if (has('amount')) {
      set.amount = parseAmount(body.amount);
      if (!set.amount) throw new HttpError(400, MONEY_ERROR);
    }
    if (has('note')) {
      const note = parseNote(body.note);
      if (note.error) throw new HttpError(400, note.error);
      set.note = note.value;
    }

    const { row, day } = await withUserLock(userId, async (tx) => {
      const current = await getTransaction(tx, userId, id);
      if (!current) throw new HttpError(404, NOT_FOUND);

      // Only a CHANGED category must be active: fixing the amount or note of an
      // entry whose category was archived since is still allowed.
      let category = current.category;
      const changes = { ...set };
      if (categoryId !== null && categoryId !== current.category.id) {
        category = await activeCategory(tx, userId, categoryId);
        changes.category_id = categoryId;
      }

      let updated = current;
      if (Object.keys(changes).length > 0) {
        [updated] = await tx
          .update(transactions)
          .set(changes)
          .where(and(eq(transactions.id, id), eq(transactions.user_id, userId)))
          .returning();
      }
      return {
        row: { ...updated, category },
        day: await getDaySummary(tx, userId, current.date),
      };
    });

    res.json({ transaction: serializeTransaction(row), day: serializeDaySummary(day) });
  })
);

// DELETE /api/transactions/:id — `day` is null when the open day became empty
// and its row was removed with it.
router.delete(
  '/:id',
  route(async (req, res) => {
    const userId = req.userId;
    const id = parseId(req.params.id);
    if (!id) throw new HttpError(400, ID_ERROR);

    const day = await withUserLock(userId, async (tx) => {
      const [removed] = await tx
        .delete(transactions)
        .where(and(eq(transactions.id, id), eq(transactions.user_id, userId)))
        .returning({ date: transactions.date });
      if (!removed) throw new HttpError(404, NOT_FOUND);
      await cleanupDay(tx, userId, removed.date);
      return getDaySummary(tx, userId, removed.date);
    });

    res.json({ ok: true, day: day ? serializeDaySummary(day) : null });
  })
);

export default router;
