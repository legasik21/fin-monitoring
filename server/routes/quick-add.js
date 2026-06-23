import crypto from 'node:crypto';
import { Router } from 'express';
import { eq, sql } from 'drizzle-orm';
import db from '../db.js';
import { days } from '../schema.js';
import { serializeDay } from '../serialize.js';

const router = Router();

/** Constant-time string compare (avoids leaking the token via response timing). */
function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

// Shortcut category key -> days column to increment.
const CATEGORY_COLUMN = {
  food_out: 'expense_food_out',
  food_market: 'expense_food_market',
  no_reason: 'expense_no_reason',
  gas: 'expense_gas',
  wants: 'expense_wants',
  health: 'expense_health',
  income_main: 'income_main',
  income_tips: 'income_tips',
};

function todayStr() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// POST /api/quick-add  — guarded by `X-API-Key: <QUICK_ADD_TOKEN>` (no JWT).
// Body: { category, amount }. Increments today's column; keeps the day open.
router.post('/', async (req, res) => {
  const token = process.env.QUICK_ADD_TOKEN;
  const provided = req.get('X-API-Key') || '';
  if (!token || !safeEqual(provided, token)) {
    return res.status(401).json({ error: 'Невірний ключ API' });
  }

  const { category, amount } = req.body || {};
  const column = CATEGORY_COLUMN[category];
  if (!column) {
    return res.status(400).json({ error: 'Невідома категорія' });
  }
  const value = Number(amount);
  if (!Number.isFinite(value) || value <= 0) {
    return res.status(400).json({ error: 'Сума має бути додатнім числом' });
  }
  const inc = Math.round(value * 100) / 100;
  const date = todayStr();

  // Atomic upsert: create today's open day, or add to the existing column value.
  await db
    .insert(days)
    .values({ date, [column]: inc, is_closed: false })
    .onConflictDoUpdate({
      target: days.date,
      // Re-open the day too: quick-add keeps today editable in-app (a previously
      // closed day is reopened rather than silently mutated behind a closed snapshot).
      set: { [column]: sql`${days[column]} + ${inc}`, is_closed: false, updated_at: new Date() },
    });

  const [row] = await db.select().from(days).where(eq(days.date, date)).limit(1);
  const s = serializeDay(row);
  const income = s.income_main + s.income_tips;
  const expenses =
    s.expense_food_out +
    s.expense_food_market +
    s.expense_no_reason +
    s.expense_gas +
    s.expense_wants +
    s.expense_health;
  res.json({
    ok: true,
    date,
    totals: {
      income: Math.round(income * 100) / 100,
      expenses: Math.round(expenses * 100) / 100,
      balance: Math.round((income - expenses) * 100) / 100,
    },
  });
});

export default router;
