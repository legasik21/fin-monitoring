// Display helpers only. Money totals always come from the server (summed in SQL);
// the client never adds amounts up, it just formats the numbers it receives.

// "1 234,50 ₴"
export function formatUAH(value) {
  const n = Number(value) || 0;
  const formatted = n.toLocaleString('uk-UA', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${formatted} ₴`;
}

// Numeric only, no currency symbol — for compact table cells.
export function formatNumber(value) {
  const n = Number(value) || 0;
  return n.toLocaleString('uk-UA', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

// A ledger entry's amount with the sign its kind implies: "+1 000,00 ₴" / "−120,50 ₴".
export function formatEntryAmount(amount, kind) {
  return `${kind === 'income' ? '+' : '−'}${formatUAH(Math.abs(Number(amount) || 0))}`;
}

// A balance with an explicit "+" for non-negative values (negatives already carry "-").
export function formatBalance(value) {
  const n = Number(value) || 0;
  return `${n >= 0 ? '+' : ''}${formatUAH(n)}`;
}

// "14:05" in the viewer's local time, for the entry list.
export function formatTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' });
}

// Text length in Unicode code points — the unit the server (Postgres char_length)
// uses for the 50/200-character limits, so an emoji counts as 1.
export function textLength(s) {
  return [...(s || '')].length;
}

// Treat blanks / junk / negatives as 0; only for client-side "is this > 0?" checks
// before a request (goal forms), never for summing money.
export function toAmount(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}
