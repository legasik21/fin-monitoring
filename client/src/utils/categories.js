import { CATEGORY_KINDS } from '../constants.js';

// The server already returns categories ordered (kind, active first, sort_order,
// id), so grouping keeps that order instead of re-sorting on the client.
export function groupByKind(categories = []) {
  const groups = Object.fromEntries(CATEGORY_KINDS.map((k) => [k, []]));
  for (const c of categories) {
    if (groups[c.kind]) groups[c.kind].push(c);
  }
  return groups;
}

// Archived categories keep appearing in history/stats, marked so the user knows
// why they are missing from the input forms. Accepts both a Category/CategoryRef
// (`name`) and a stats column/pie entry (`label`).
export function categoryLabel(category) {
  if (!category) return '';
  const name = category.name ?? category.label ?? '';
  return category.archived ? `${name} (архів)` : name;
}
