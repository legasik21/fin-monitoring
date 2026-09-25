import { eq } from 'drizzle-orm';
import { categories, users } from '../schema.js';

export const CATEGORY_KINDS = ['income', 'expense'];

// Max ACTIVE categories per kind. Archived ones do not count. Mirrored in the client.
export const CATEGORY_LIMITS = { income: 5, expense: 10 };

export const CATEGORY_NAME_MAX = 50;

// What a new user gets for a kind they did not customise at registration.
export const DEFAULT_CATEGORY_NAMES = { income: 'Дохід', expense: 'Витрати' };

// Fixed palette colours are auto-assigned from (users never type a colour).
// 16 entries ≥ the 15 active categories a user can have, so active colours stay unique.
export const CATEGORY_PALETTE = [
  '#00C896', '#4D9EFF', '#FF4D4D', '#FFA64D',
  '#B84DFF', '#FF7AA2', '#FFD84D', '#4DD9E0',
  '#8C9EFF', '#7CF0C8', '#FF8A4C', '#C3E88D',
  '#E57CD8', '#5CC8FF', '#F2B880', '#A0A8B8',
];

// Income prefers the greens/blues first, expenses the reds/oranges, so the
// defaults read naturally in charts.
const PREFERRED_ORDER = {
  income: [0, 1, 9, 7, 11, 13, 8, 6, 2, 3, 4, 5, 10, 12, 14, 15],
  expense: [2, 3, 4, 5, 10, 12, 6, 14, 1, 8, 7, 0, 9, 11, 13, 15],
};

export const isCategoryKind = (kind) => CATEGORY_KINDS.includes(kind);

export const kindLimitError = (kind) =>
  kind === 'income'
    ? `Досягнуто ліміт: максимум ${CATEGORY_LIMITS.income} активних категорій доходу`
    : `Досягнуто ліміт: максимум ${CATEGORY_LIMITS.expense} активних категорій витрат`;

/**
 * Trim and validate a category name. Length is counted in code points so it
 * matches Postgres char_length() (an emoji counts as 1, not 2).
 * Returns { name } or { error } with a Ukrainian message.
 */
export function normalizeCategoryName(raw) {
  if (typeof raw !== 'string') return { error: 'Вкажіть назву категорії' };
  const name = raw.trim();
  const length = [...name].length;
  if (length === 0) return { error: 'Вкажіть назву категорії' };
  if (length > CATEGORY_NAME_MAX) {
    return { error: `Назва категорії — до ${CATEGORY_NAME_MAX} символів` };
  }
  return { name };
}

/** Case-insensitive key used to detect duplicate active names within a kind. */
export const nameKey = (name) => name.toLocaleLowerCase('uk-UA');

/**
 * Pick a colour for a new category of `kind`: first preferred colour not used by
 * any of the user's categories, else one not used by an active category, else cycle.
 * `existing` = [{ color, archived_at }] for all of the user's categories.
 */
export function pickColor(kind, existing = []) {
  const order = PREFERRED_ORDER[kind] || PREFERRED_ORDER.expense;
  const all = new Set(existing.map((c) => c.color));
  const active = new Set(existing.filter((c) => !c.archived_at).map((c) => c.color));
  for (const i of order) if (!all.has(CATEGORY_PALETTE[i])) return CATEGORY_PALETTE[i];
  for (const i of order) if (!active.has(CATEGORY_PALETTE[i])) return CATEGORY_PALETTE[i];
  return CATEGORY_PALETTE[order[existing.length % order.length]];
}

/**
 * Validate the optional `categories` block of POST /api/auth/register:
 *   { income?: string[], expense?: string[] }
 * A kind that is missing or empty falls back to its single default category.
 * Returns { value: { income: string[], expense: string[] } } or { error }.
 */
export function resolveRegistrationCategories(input) {
  if (input === undefined || input === null) {
    return {
      value: { income: [DEFAULT_CATEGORY_NAMES.income], expense: [DEFAULT_CATEGORY_NAMES.expense] },
    };
  }
  if (typeof input !== 'object' || Array.isArray(input)) {
    return { error: 'Невірний формат категорій' };
  }
  const value = {};
  for (const kind of CATEGORY_KINDS) {
    const list = input[kind];
    if (list === undefined || list === null || (Array.isArray(list) && list.length === 0)) {
      value[kind] = [DEFAULT_CATEGORY_NAMES[kind]];
      continue;
    }
    if (!Array.isArray(list)) return { error: 'Невірний формат категорій' };
    if (list.length > CATEGORY_LIMITS[kind]) return { error: kindLimitError(kind) };
    const names = [];
    const seen = new Set();
    for (const raw of list) {
      const { name, error } = normalizeCategoryName(raw);
      if (error) return { error };
      const key = nameKey(name);
      if (seen.has(key)) return { error: `Категорія «${name}» вказана двічі` };
      seen.add(key);
      names.push(name);
    }
    value[kind] = names;
  }
  return { value };
}

/**
 * Lock the user's row until the surrounding transaction ends. Every
 * check-then-write on a user's categories (limits, last-active rule) takes this
 * lock first, so concurrent requests for the same user are serialised and cannot
 * both pass a count check.
 */
export async function lockUser(tx, userId) {
  await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).for('update');
}

/** Insert a freshly registered user's initial categories (inside the registration transaction). */
export async function insertInitialCategories(tx, userId, { income, expense }) {
  const rows = [];
  for (const [kind, names] of [['income', income], ['expense', expense]]) {
    names.forEach((name, i) => {
      rows.push({ user_id: userId, kind, name, sort_order: i, color: pickColor(kind, rows) });
    });
  }
  return tx.insert(categories).values(rows).returning();
}
