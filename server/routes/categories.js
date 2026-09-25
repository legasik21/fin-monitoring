import { Router } from 'express';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import db from '../db.js';
import { categories } from '../schema.js';
import {
  CATEGORY_LIMITS,
  isCategoryKind,
  kindLimitError,
  nameKey,
  normalizeCategoryName,
  pickColor,
} from '../lib/categories.js';
import {
  HttpError,
  ID_ERROR,
  bodyOf,
  parseId,
  pgError,
  route,
  withUserLock,
} from '../lib/ledger.js';
import { serializeCategory } from '../serialize.js';

const router = Router();

const NOT_FOUND = 'Категорію не знайдено';
const KIND_ERROR = 'Невірний тип категорії';
const ORDER_ERROR = 'Невірний порядок категорій';
const DUPLICATE_ERROR = 'Категорія з такою назвою вже існує';

// income first, then active before archived, then the user's order.
const listOrder = () => [
  sql`${categories.kind} = 'expense'`,
  sql`${categories.archived_at} is not null`,
  asc(categories.sort_order),
  asc(categories.id),
];

/** All of the caller's categories (archived too: pickColor avoids their colours). */
const loadAll = (q, userId) =>
  q.select().from(categories).where(eq(categories.user_id, userId)).orderBy(...listOrder());

const isActive = (c) => !c.archived_at;

/** Is `name` already used by another ACTIVE category of this kind (case-insensitive)? */
function isDuplicateName(all, kind, name, exceptId = null) {
  const key = nameKey(name);
  return all.some(
    (c) => c.kind === kind && isActive(c) && c.id !== exceptId && nameKey(c.name) === key
  );
}

/** The caller's category from their loaded list, or a 404 (foreign ids look missing). */
function findOwned(all, id) {
  const target = all.find((c) => c.id === id);
  if (!target) throw new HttpError(404, NOT_FOUND);
  return target;
}

/**
 * Run a create/rename. The JS pre-check misses a concurrent duplicate or a name
 * whose Postgres lower() differs from JS case-folding; the partial unique index
 * catches those, and that is still a 409, not a 500.
 */
async function nameWrite(fn) {
  try {
    return await fn();
  } catch (err) {
    const pgErr = pgError(err);
    if (pgErr?.code === '23505' && pgErr.constraint === 'categories_active_name_unique') {
      throw new HttpError(409, DUPLICATE_ERROR);
    }
    throw err;
  }
}

function urlId(req) {
  const id = parseId(req.params.id);
  if (!id) throw new HttpError(400, ID_ERROR);
  return id;
}

// GET /api/categories — active only; ?include_archived=1 → all
router.get(
  '/',
  route(async (req, res) => {
    const all = req.query.include_archived === '1' || req.query.include_archived === 'true';
    const rows = await db
      .select()
      .from(categories)
      .where(and(eq(categories.user_id, req.userId), all ? undefined : isNull(categories.archived_at)))
      .orderBy(...listOrder());
    res.json(rows.map(serializeCategory));
  })
);

// PUT /api/categories/order  { kind, ids } — ids must be exactly the caller's
// active categories of that kind, in the new order. Registered before /:id.
router.put(
  '/order',
  route(async (req, res) => {
    const userId = req.userId;
    const body = bodyOf(req);
    const { kind } = body;
    if (!isCategoryKind(kind)) throw new HttpError(400, KIND_ERROR);
    if (!Array.isArray(body.ids)) throw new HttpError(400, ORDER_ERROR);
    const ids = body.ids.map(parseId);
    if (ids.some((id) => !id)) throw new HttpError(400, ID_ERROR);

    const rows = await withUserLock(userId, async (tx) => {
      const all = await loadAll(tx, userId);
      const byId = new Map(all.map((c) => [c.id, c]));
      // Unknown or foreign ids look the same: "not found".
      if (ids.some((id) => !byId.has(id))) throw new HttpError(404, NOT_FOUND);

      const activeOfKind = all.filter((c) => c.kind === kind && isActive(c));
      const exactSet =
        new Set(ids).size === ids.length &&
        ids.length === activeOfKind.length &&
        ids.every((id) => byId.get(id).kind === kind && isActive(byId.get(id)));
      if (!exactSet) throw new HttpError(400, ORDER_ERROR);

      for (const [position, id] of ids.entries()) {
        if (byId.get(id).sort_order === position) continue;
        await tx
          .update(categories)
          .set({ sort_order: position })
          .where(and(eq(categories.id, id), eq(categories.user_id, userId)));
      }
      return tx
        .select()
        .from(categories)
        .where(
          and(
            eq(categories.user_id, userId),
            eq(categories.kind, kind),
            isNull(categories.archived_at)
          )
        )
        .orderBy(asc(categories.sort_order), asc(categories.id));
    });
    res.json(rows.map(serializeCategory));
  })
);

// GET /api/categories/:id — active or archived
router.get(
  '/:id',
  route(async (req, res) => {
    const id = urlId(req);
    const [row] = await db
      .select()
      .from(categories)
      .where(and(eq(categories.id, id), eq(categories.user_id, req.userId)))
      .limit(1);
    if (!row) throw new HttpError(404, NOT_FOUND);
    res.json(serializeCategory(row));
  })
);

// POST /api/categories  { kind, name } — colour and position are assigned here.
router.post(
  '/',
  route(async (req, res) => {
    const userId = req.userId;
    const body = bodyOf(req);
    const { kind } = body;
    if (!isCategoryKind(kind)) throw new HttpError(400, KIND_ERROR);
    const { name, error } = normalizeCategoryName(body.name);
    if (error) throw new HttpError(400, error);

    const created = await nameWrite(() =>
      withUserLock(userId, async (tx) => {
        const all = await loadAll(tx, userId);
        // Limits count ACTIVE categories only; archived ones free their slot.
        const activeOfKind = all.filter((c) => c.kind === kind && isActive(c));
        if (activeOfKind.length >= CATEGORY_LIMITS[kind]) {
          throw new HttpError(400, kindLimitError(kind));
        }
        if (isDuplicateName(all, kind, name)) throw new HttpError(409, DUPLICATE_ERROR);

        const sortOrder = activeOfKind.length
          ? Math.max(...activeOfKind.map((c) => c.sort_order)) + 1
          : 0;
        const [row] = await tx
          .insert(categories)
          .values({ user_id: userId, kind, name, color: pickColor(kind, all), sort_order: sortOrder })
          .returning();
        return row;
      })
    );
    res.status(201).json(serializeCategory(created));
  })
);

// PATCH /api/categories/:id  { name } — rename an active category. A case-only
// rename of itself (їжа → Їжа) is not a duplicate.
router.patch(
  '/:id',
  route(async (req, res) => {
    const userId = req.userId;
    const id = urlId(req);
    const { name, error } = normalizeCategoryName(bodyOf(req).name);
    if (error) throw new HttpError(400, error);

    const row = await nameWrite(() =>
      withUserLock(userId, async (tx) => {
        const all = await loadAll(tx, userId);
        const target = findOwned(all, id);
        if (!isActive(target)) throw new HttpError(400, 'Архівну категорію не можна змінити');
        if (isDuplicateName(all, target.kind, name, id)) throw new HttpError(409, DUPLICATE_ERROR);
        if (name === target.name) return target;

        const [updated] = await tx
          .update(categories)
          .set({ name })
          .where(and(eq(categories.id, id), eq(categories.user_id, userId)))
          .returning();
        return updated;
      })
    );
    res.json(serializeCategory(row));
  })
);

// DELETE /api/categories/:id — archives: the row stays so its transactions keep
// their label in history and stats. Idempotent for an already archived one.
router.delete(
  '/:id',
  route(async (req, res) => {
    const userId = req.userId;
    const id = urlId(req);

    const row = await withUserLock(userId, async (tx) => {
      const all = await loadAll(tx, userId);
      const target = findOwned(all, id);
      if (!isActive(target)) return target;
      // Every kind keeps at least one active category, so entry forms and
      // quick-add always have something to pick.
      const activeOfKind = all.filter((c) => c.kind === target.kind && isActive(c));
      if (activeOfKind.length <= 1) {
        throw new HttpError(400, 'Не можна видалити останню активну категорію цього типу');
      }

      const [archived] = await tx
        .update(categories)
        .set({ archived_at: sql`now()` })
        .where(and(eq(categories.id, id), eq(categories.user_id, userId)))
        .returning();
      return archived;
    });
    res.json(serializeCategory(row));
  })
);

export default router;
