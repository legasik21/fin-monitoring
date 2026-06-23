import { Router } from 'express';
import { eq, desc } from 'drizzle-orm';
import db from '../db.js';
import { days } from '../schema.js';
import { serializeDay } from '../serialize.js';

const router = Router();

const NUMERIC_FIELDS = [
  'income_main',
  'income_tips',
  'expense_food_out',
  'expense_food_market',
  'expense_no_reason',
  'expense_gas',
  'expense_wants',
  'expense_health',
];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Local "today" as YYYY-MM-DD. */
function todayStr() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Clamp to a non-negative number with at most 2 decimals; junk becomes 0. */
function sanitizeAmount(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * 100) / 100;
}

/** Build a clean, fully-defaulted row payload from arbitrary input. */
function buildValues(date, body = {}) {
  const values = { date, is_closed: Boolean(body.is_closed) };
  for (const field of NUMERIC_FIELDS) {
    values[field] = sanitizeAmount(body[field]);
  }
  return values;
}

async function getByDate(date) {
  const [row] = await db.select().from(days).where(eq(days.date, date)).limit(1);
  return row || null;
}

/** Insert-or-update a day on the unique `date`, mirroring the old SQLite upsert. */
async function upsertDay(date, body) {
  const values = buildValues(date, body);
  const { date: _omitDate, ...mutable } = values;
  await db
    .insert(days)
    .values(values)
    .onConflictDoUpdate({
      target: days.date,
      set: { ...mutable, updated_at: new Date() },
    });
  return getByDate(date);
}

// GET /api/days — list all days (newest first)
router.get('/', async (_req, res) => {
  const rows = await db.select().from(days).orderBy(desc(days.date));
  res.json(rows.map(serializeDay));
});

// GET /api/days/today — today's record or 404
router.get('/today', async (_req, res) => {
  const row = await getByDate(todayStr());
  if (!row) return res.status(404).json({ error: 'Сьогодні ще немає записів' });
  res.json(serializeDay(row));
});

// GET /api/days/:date — record by date
router.get('/:date', async (req, res) => {
  const { date } = req.params;
  if (!DATE_RE.test(date)) {
    return res.status(400).json({ error: 'Невірний формат дати (очікується YYYY-MM-DD)' });
  }
  const row = await getByDate(date);
  if (!row) return res.status(404).json({ error: 'Запис не знайдено' });
  res.json(serializeDay(row));
});

// POST /api/days — create (upsert) a day record
router.post('/', async (req, res) => {
  const date = req.body?.date || todayStr();
  if (!DATE_RE.test(date)) {
    return res.status(400).json({ error: 'Невірний формат дати (очікується YYYY-MM-DD)' });
  }
  const row = await upsertDay(date, req.body);
  res.status(201).json(serializeDay(row));
});

// PUT /api/days/:date — update (upsert) a day record
router.put('/:date', async (req, res) => {
  const { date } = req.params;
  if (!DATE_RE.test(date)) {
    return res.status(400).json({ error: 'Невірний формат дати (очікується YYYY-MM-DD)' });
  }
  const row = await upsertDay(date, req.body);
  res.json(serializeDay(row));
});

// PATCH /api/days/:date/close — finalize a day
router.patch('/:date/close', async (req, res) => {
  const { date } = req.params;
  if (!DATE_RE.test(date)) {
    return res.status(400).json({ error: 'Невірний формат дати (очікується YYYY-MM-DD)' });
  }
  const existing = await getByDate(date);
  if (!existing) {
    return res.status(404).json({ error: 'Запис не знайдено' });
  }
  await db
    .update(days)
    .set({ is_closed: true, updated_at: new Date() })
    .where(eq(days.date, date));
  res.json(serializeDay(await getByDate(date)));
});

export default router;
