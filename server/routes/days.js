import { Router } from 'express';
import db from '../db.js';
import { isValidDateStr, todayStr } from '../lib/dates.js';
import {
  DATE_ERROR,
  HttpError,
  closeDay,
  getDaySummary,
  listDayTransactions,
  queryDaySummaries,
  readSnapshot,
  route,
  withUserLock,
} from '../lib/ledger.js';
import { serializeDaySummary, serializeTransaction } from '../serialize.js';

// Days are "recorded" dates of the ledger; their totals are always computed from
// transactions (lib/ledger.js). Entries are added through /api/transactions, so
// the old column upserts (POST /, PUT /:date) are gone.
const router = Router();

function validDate(date) {
  if (!isValidDateStr(date)) throw new HttpError(400, DATE_ERROR);
  return date;
}

// GET /api/days — the caller's recorded days, newest first
router.get(
  '/',
  route(async (req, res) => {
    const rows = await queryDaySummaries(db, req.userId);
    res.json(rows.map(serializeDaySummary));
  })
);

// GET /api/days/today — today's summary or 404 (registered before /:date)
router.get(
  '/today',
  route(async (req, res) => {
    const row = await getDaySummary(db, req.userId, todayStr());
    if (!row) throw new HttpError(404, 'Сьогодні ще немає записів');
    res.json(serializeDaySummary(row));
  })
);

// GET /api/days/:date — summary plus the day's entries (oldest first). One
// snapshot, so the totals always match the listed entries.
router.get(
  '/:date',
  route(async (req, res) => {
    const date = validDate(req.params.date);
    const result = await readSnapshot(async (tx) => {
      const day = await getDaySummary(tx, req.userId, date);
      if (!day) return null;
      return { day, entries: await listDayTransactions(tx, req.userId, date) };
    });
    if (!result) throw new HttpError(404, 'Запис не знайдено');
    res.json({
      ...serializeDaySummary(result.day),
      transactions: result.entries.map((row) => serializeTransaction(row)),
    });
  })
);

// PATCH /api/days/:date/close — finalise a day; creates it closed when nothing
// was recorded yet, so an empty day can still count as logged.
router.patch(
  '/:date/close',
  route(async (req, res) => {
    const date = validDate(req.params.date);
    const day = await withUserLock(req.userId, async (tx) => {
      await closeDay(tx, req.userId, date);
      return getDaySummary(tx, req.userId, date);
    });
    res.json(serializeDaySummary(day));
  })
);

export default router;
