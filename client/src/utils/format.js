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

// Treat blanks / junk / negatives as 0; used by the live summary.
export function toAmount(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}
