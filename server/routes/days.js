import { Router } from 'express';
import db from '../db.js';

const router = Router();

const NUMERIC_FIELDS = [
  'income_main',
  'income_tips',
  'expense_food_out',
  'expense_food_market',
  'expense_no_reason',
  'expense_gas',
];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Local "today" as YYYY-MM-DD (server and client share the machine in dev). */
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
function buildPayload(date, body = {}) {
  const payload = { date, is_closed: body.is_closed ? 1 : 0 };
  for (const field of NUMERIC_FIELDS) {
    payload[field] = sanitizeAmount(body[field]);
  }
  return payload;
}

const selectByDate = db.prepare('SELECT * FROM days WHERE date = ?');
const selectAll = db.prepare('SELECT * FROM days ORDER BY date DESC');

const upsertStmt = db.prepare(`
  INSERT INTO days (
    date, income_main, income_tips,
    expense_food_out, expense_food_market, expense_no_reason, expense_gas,
    is_closed, updated_at
  ) VALUES (
    @date, @income_main, @income_tips,
    @expense_food_out, @expense_food_market, @expense_no_reason, @expense_gas,
    @is_closed, datetime('now')
  )
  ON CONFLICT(date) DO UPDATE SET
    income_main         = excluded.income_main,
    income_tips         = excluded.income_tips,
    expense_food_out    = excluded.expense_food_out,
    expense_food_market = excluded.expense_food_market,
    expense_no_reason   = excluded.expense_no_reason,
    expense_gas         = excluded.expense_gas,
    is_closed           = excluded.is_closed,
    updated_at          = datetime('now')
`);

const closeStmt = db.prepare(
  "UPDATE days SET is_closed = 1, updated_at = datetime('now') WHERE date = ?"
);

// GET /api/days — list all days (newest first)
router.get('/', (_req, res) => {
  res.json(selectAll.all());
});

// GET /api/days/today — today's record or 404
router.get('/today', (_req, res) => {
  const row = selectByDate.get(todayStr());
  if (!row) return res.status(404).json({ error: 'Сьогодні ще немає записів' });
  res.json(row);
});

// GET /api/days/:date — record by date
router.get('/:date', (req, res) => {
  const { date } = req.params;
  if (!DATE_RE.test(date)) {
    return res.status(400).json({ error: 'Невірний формат дати (очікується YYYY-MM-DD)' });
  }
  const row = selectByDate.get(date);
  if (!row) return res.status(404).json({ error: 'Запис не знайдено' });
  res.json(row);
});

// POST /api/days — create (upsert) a day record
router.post('/', (req, res) => {
  const date = req.body?.date || todayStr();
  if (!DATE_RE.test(date)) {
    return res.status(400).json({ error: 'Невірний формат дати (очікується YYYY-MM-DD)' });
  }
  const payload = buildPayload(date, req.body);
  upsertStmt.run(payload);
  res.status(201).json(selectByDate.get(date));
});

// PUT /api/days/:date — update (upsert) a day record
router.put('/:date', (req, res) => {
  const { date } = req.params;
  if (!DATE_RE.test(date)) {
    return res.status(400).json({ error: 'Невірний формат дати (очікується YYYY-MM-DD)' });
  }
  const payload = buildPayload(date, req.body);
  upsertStmt.run(payload);
  res.json(selectByDate.get(date));
});

// PATCH /api/days/:date/close — finalize a day
router.patch('/:date/close', (req, res) => {
  const { date } = req.params;
  if (!DATE_RE.test(date)) {
    return res.status(400).json({ error: 'Невірний формат дати (очікується YYYY-MM-DD)' });
  }
  const existing = selectByDate.get(date);
  if (!existing) {
    return res.status(404).json({ error: 'Запис не знайдено' });
  }
  closeStmt.run(date);
  res.json(selectByDate.get(date));
});

export default router;
