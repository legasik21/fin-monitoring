import { Router } from 'express';
import db from '../db.js';

const router = Router();

const EXPENSE_CATEGORIES = [
  { key: 'expense_food_out', label: 'Їжа', color: '#FF4D4D' },
  { key: 'expense_food_market', label: 'Продукти', color: '#FFA64D' },
  { key: 'expense_no_reason', label: '«Ні за що»', color: '#B84DFF' },
  { key: 'expense_gas', label: 'Пальне', color: '#4D9EFF' },
  { key: 'expense_wants', label: 'Фізичні хотілки', color: '#00C896' },
];

const MONTHS_SHORT = [
  'січ', 'лют', 'бер', 'кві', 'тра', 'чер',
  'лип', 'сер', 'вер', 'жов', 'лис', 'гру',
];

const selectAll = db.prepare('SELECT * FROM days ORDER BY date ASC');

// ---- date helpers (all local-time, operating on YYYY-MM-DD) ----
function parseDate(str) {
  const [y, m, d] = str.split('-').map(Number);
  return new Date(y, m - 1, d);
}
function fmtDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}
function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}
function addMonths(date, n) {
  return new Date(date.getFullYear(), date.getMonth() + n, 1);
}
function mondayOf(date) {
  const d = new Date(date);
  const dow = (d.getDay() + 6) % 7; // 0 = Monday … 6 = Sunday
  d.setDate(d.getDate() - dow);
  d.setHours(0, 0, 0, 0);
  return d;
}
const dm = (date) =>
  `${String(date.getDate()).padStart(2, '0')}.${String(date.getMonth() + 1).padStart(2, '0')}`;

const round2 = (n) => Math.round(n * 100) / 100;
const incomeOf = (r) => r.income_main + r.income_tips;
const expensesOf = (r) =>
  r.expense_food_out + r.expense_food_market + r.expense_no_reason + r.expense_gas + r.expense_wants;
const balanceOf = (r) => incomeOf(r) - expensesOf(r);

/**
 * Build the ordered, continuous list of chart buckets for the window plus a
 * function that maps any date string to the key of the bucket it belongs to.
 */
function buildBuckets(range, today) {
  const buckets = [];
  if (range === 'week') {
    const thisMonday = mondayOf(today);
    for (let i = 7; i >= 0; i--) {
      const start = addDays(thisMonday, -7 * i);
      buckets.push({ key: fmtDate(start), label: dm(start) });
    }
    return { buckets, keyOf: (str) => fmtDate(mondayOf(parseDate(str))) };
  }
  if (range === 'month') {
    const first = startOfMonth(today);
    for (let i = 5; i >= 0; i--) {
      const m = addMonths(first, -i);
      buckets.push({
        key: fmtDate(m).slice(0, 7),
        label: `${MONTHS_SHORT[m.getMonth()]} ${m.getFullYear()}`,
      });
    }
    return { buckets, keyOf: (str) => str.slice(0, 7) };
  }
  // default: day — last 7 days
  for (let i = 6; i >= 0; i--) {
    const d = addDays(today, -i);
    buckets.push({ key: fmtDate(d), label: dm(d) });
  }
  return { buckets, keyOf: (str) => str };
}

function windowStart(range, today) {
  if (range === 'week') return addDays(mondayOf(today), -7 * 7);
  if (range === 'month') return addMonths(startOfMonth(today), -5);
  return addDays(today, -6);
}

// GET /api/stats?range=day|week|month
router.get('/', (req, res) => {
  const range = ['day', 'week', 'month'].includes(req.query.range)
    ? req.query.range
    : 'day';

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const fromStr = fmtDate(windowStart(range, today));
  const toStr = fmtDate(today);

  const rows = selectAll
    .all()
    .filter((r) => r.date >= fromStr && r.date <= toStr);

  const { buckets, keyOf } = buildBuckets(range, today);
  const bucketIndex = new Map(buckets.map((b, i) => [b.key, i]));
  const chart = buckets.map((b) => ({ label: b.label, income: 0, expenses: 0 }));

  const categoryTotals = Object.fromEntries(EXPENSE_CATEGORIES.map((c) => [c.key, 0]));
  let totalIncome = 0;
  let totalExpenses = 0;
  let best = null;
  let worst = null;

  for (const r of rows) {
    const idx = bucketIndex.get(keyOf(r.date));
    if (idx !== undefined) {
      chart[idx].income += incomeOf(r);
      chart[idx].expenses += expensesOf(r);
    }
    totalIncome += incomeOf(r);
    totalExpenses += expensesOf(r);
    for (const c of EXPENSE_CATEGORIES) categoryTotals[c.key] += r[c.key];

    const bal = balanceOf(r);
    if (best === null || bal > best.balance) best = { date: r.date, balance: round2(bal) };
    if (worst === null || bal < worst.balance) worst = { date: r.date, balance: round2(bal) };
  }

  chart.forEach((c) => {
    c.income = round2(c.income);
    c.expenses = round2(c.expenses);
  });

  const categories = EXPENSE_CATEGORIES.map((c) => ({
    key: c.key,
    label: c.label,
    color: c.color,
    value: round2(categoryTotals[c.key]),
    percent: totalExpenses > 0 ? round2((categoryTotals[c.key] / totalExpenses) * 100) : 0,
  }));

  const recordedDays = rows.length;
  const summary = {
    avgIncome: recordedDays ? round2(totalIncome / recordedDays) : 0,
    avgExpenses: recordedDays ? round2(totalExpenses / recordedDays) : 0,
    bestDay: best,
    worstDay: worst,
  };

  res.json({
    range,
    from: fromStr,
    to: toStr,
    hasData: recordedDays > 0,
    chart,
    categories,
    totalExpenses: round2(totalExpenses),
    summary,
    days: [...rows].reverse(), // newest first for the table
  });
});

export default router;
