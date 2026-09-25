// Money helpers. The DB stores money as numeric(14,2) and node-pg returns those
// values as strings ("12.30"). Amounts go to Postgres as canonical 'D.DD' strings
// and come back to the client as JS numbers with at most 2 decimals.
// Sums must run in SQL (`sum(amount)`); JS only converts the final results.

// Largest value numeric(14,2) can hold: 999 999 999 999.99.
export const MAX_AMOUNT_CENTS = 99_999_999_999_999;

// Plain decimal, optionally with a Ukrainian decimal comma ("12,5"). Rejects
// exotic Number() inputs such as "0x10", "1e3", "Infinity".
const DECIMAL_RE = /^-?\d+(?:[.,]\d+)?$/;

/** Parse a number or decimal string into integer cents; null when it is not a number. */
function toCents(value) {
  let n;
  if (typeof value === 'number') {
    n = value;
  } else if (typeof value === 'string') {
    const s = value.trim();
    if (!DECIMAL_RE.test(s)) return null;
    n = Number(s.replace(',', '.'));
  } else {
    return null;
  }
  if (!Number.isFinite(n)) return null;
  // toPrecision(15) strips binary noise first, so 1.005 * 100 rounds to 101, not 100.
  return Math.round(Number((n * 100).toPrecision(15)));
}

/** Non-negative integer cents → canonical 'D.DD' string (exact, no float formatting). */
function centsToString(cents) {
  return `${Math.trunc(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;
}

/**
 * Validate a money amount from user input. Returns the canonical 'D.DD' string
 * to store, or null when the input is not a number, rounds to ≤ 0 (or < 0 with
 * allowZero), or exceeds numeric(14,2).
 */
export function parseAmount(value, { allowZero = false } = {}) {
  const cents = toCents(value);
  if (cents === null || cents < 0 || cents > MAX_AMOUNT_CENTS) return null;
  if (cents === 0 && !allowZero) return null;
  return centsToString(cents);
}

/** numeric string (or null from an empty SUM) → JS number. */
export function toMoney(value) {
  if (value === null || value === undefined) return 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** Round a derived value (average, percentage, ratio) to 2 decimals. */
export function round2(n) {
  return Math.round(Number((n * 100).toPrecision(15))) / 100;
}
