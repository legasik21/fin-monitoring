export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const MONTH_RE = /^\d{4}-\d{2}$/;

/** Local calendar date as YYYY-MM-DD (server clock; TZ=Europe/Kyiv in production). */
export function toDateStr(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Local "today" as YYYY-MM-DD. */
export function todayStr() {
  return toDateStr(new Date());
}

/**
 * True only for a real calendar date in YYYY-MM-DD form, so impossible dates
 * like 2026-02-30 are rejected with a 400 instead of reaching Postgres as a 500.
 */
export function isValidDateStr(value) {
  if (typeof value !== 'string' || !DATE_RE.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  if (y < 1900 || y > 2100) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** True for a YYYY-MM month string with a valid month number. */
export function isValidMonthStr(value) {
  if (typeof value !== 'string' || !MONTH_RE.test(value)) return false;
  const [y, m] = value.split('-').map(Number);
  return y >= 1900 && y <= 2100 && m >= 1 && m <= 12;
}
