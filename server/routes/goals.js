import { Router } from 'express';
import { eq, desc } from 'drizzle-orm';
import db from '../db.js';
import { goals } from '../schema.js';

const router = Router();

/** Clamp to a non-negative number with at most 2 decimals; junk becomes 0. */
function sanitizeAmount(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * 100) / 100;
}

/** Add the derived `percent` (0–100) the client renders the progress bar from. */
function serializeGoal(g) {
  if (!g) return g;
  const target = Number(g.target_amount);
  const current = Number(g.current_amount);
  const percent = target > 0 ? Math.min(100, Math.round((current / target) * 1000) / 10) : 0;
  return {
    id: g.id,
    title: g.title,
    target_amount: target,
    current_amount: current,
    achieved: Boolean(g.achieved),
    percent,
    created_at: g.created_at,
  };
}

function parseId(raw) {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

async function getGoal(id) {
  const [g] = await db.select().from(goals).where(eq(goals.id, id)).limit(1);
  return g || null;
}

// GET /api/goals — newest first
router.get('/', async (_req, res) => {
  const rows = await db.select().from(goals).orderBy(desc(goals.created_at));
  res.json(rows.map(serializeGoal));
});

// POST /api/goals  { title, target_amount }
router.post('/', async (req, res) => {
  const title = (req.body?.title ?? '').toString().trim();
  const target = sanitizeAmount(req.body?.target_amount);
  if (!title) return res.status(400).json({ error: 'Вкажіть назву цілі' });
  if (title.length > 200) return res.status(400).json({ error: 'Назва занадто довга' });
  if (target <= 0) return res.status(400).json({ error: 'Сума цілі має бути більшою за 0' });

  const [created] = await db
    .insert(goals)
    .values({ title, target_amount: target, current_amount: 0, achieved: false })
    .returning();
  res.status(201).json(serializeGoal(created));
});

// PATCH /api/goals/:id  { title?, target_amount?, contribute?, current_amount? }
// `contribute` adds to current_amount; `current_amount` sets it absolutely.
router.patch('/:id', async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Невірний ідентифікатор' });
  const existing = await getGoal(id);
  if (!existing) return res.status(404).json({ error: 'Ціль не знайдено' });

  const set = {};

  if (typeof req.body?.title === 'string' && req.body.title.trim()) {
    const t = req.body.title.trim();
    if (t.length > 200) return res.status(400).json({ error: 'Назва занадто довга' });
    set.title = t;
  }

  let target = Number(existing.target_amount);
  const targetTouched = req.body?.target_amount !== undefined;
  if (targetTouched) {
    target = sanitizeAmount(req.body.target_amount);
    if (target <= 0) return res.status(400).json({ error: 'Сума цілі має бути більшою за 0' });
    set.target_amount = target;
  }

  let current = Number(existing.current_amount);
  const amountTouched =
    req.body?.current_amount !== undefined || req.body?.contribute !== undefined;
  if (req.body?.current_amount !== undefined) current = sanitizeAmount(req.body.current_amount);
  if (req.body?.contribute !== undefined) {
    current = Math.round((current + sanitizeAmount(req.body.contribute)) * 100) / 100;
  }
  // Only re-write the amount / re-evaluate `achieved` when the amount or target
  // actually changed — a title-only edit must not flip achieved via float drift.
  if (amountTouched) set.current_amount = current;
  if (amountTouched || targetTouched) set.achieved = target > 0 && current >= target;

  const [updated] = await db.update(goals).set(set).where(eq(goals.id, id)).returning();
  res.json(serializeGoal(updated));
});

// DELETE /api/goals/:id
router.delete('/:id', async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Невірний ідентифікатор' });
  const existing = await getGoal(id);
  if (!existing) return res.status(404).json({ error: 'Ціль не знайдено' });
  await db.delete(goals).where(eq(goals.id, id));
  res.json({ ok: true });
});

export default router;
