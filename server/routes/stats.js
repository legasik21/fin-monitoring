import { Router } from 'express';
import { asc } from 'drizzle-orm';
import db from '../db.js';
import { days } from '../schema.js';
import { serializeDay } from '../serialize.js';

const router = Router();

const EXPENSE_CATEGORIES = [
  { key: 'expense_food_out', label: 'Їжа', color: '#FF4D4D' },
  { key: 'expense_food_market', label: 'Продукти', color: '#FFA64D' },
  { key: 'expense_no_reason', label: '«Ні за що»', color: '#B84DFF' },
  { key: 'expense_gas', label: 'Пальне', color: '#4D9EFF' },
  { key: 'expense_wants', label: 'Фізичні хотілки', color: '#00C896' },
  { key: 'expense_health', label: "Здоров'я", color: '#FF7AA2' },
];

const MONTHS_SHORT = [
  'січ', 'лют', 'бер', 'кві', 'тра', 'чер',
  'лип', 'сер', 'вер', 'жов', 'лис', 'гру',
];

// Load every day (oldest first) and normalise to the legacy row shape so the
// JS aggregation below is identical to the original SQLite implementation.
const loadAllDays = async () =>
  (await db.select().from(days).orderBy(asc(days.date))).map(serializeDay);

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
  r.expense_food_out +
  r.expense_food_market +
  r.expense_no_reason +
  r.expense_gas +
  r.expense_wants +
  r.expense_health;
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
router.get('/', async (req, res) => {
  const range = ['day', 'week', 'month'].includes(req.query.range)
    ? req.query.range
    : 'day';

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const fromStr = fmtDate(windowStart(range, today));
  const toStr = fmtDate(today);

  const rows = (await loadAllDays()).filter(
    (r) => r.date >= fromStr && r.date <= toStr
  );

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

// GET /api/stats/streak — consecutive-days logging streak (Feature 2)
router.get('/streak', async (_req, res) => {
  const rows = await loadAllDays(); // oldest first, unique dates
  const dateSet = new Set(rows.map((r) => r.date));

  // Longest run of consecutive calendar days ever recorded.
  let longest = 0;
  let run = 0;
  let prev = null;
  for (const r of rows) {
    if (prev && fmtDate(addDays(parseDate(prev), 1)) === r.date) run += 1;
    else run = 1;
    if (run > longest) longest = run;
    prev = r.date;
  }

  // Current streak: walk back from today (or yesterday if today isn't logged).
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  let cursor = null;
  if (dateSet.has(fmtDate(today))) cursor = today;
  else if (dateSet.has(fmtDate(addDays(today, -1)))) cursor = addDays(today, -1);

  let current = 0;
  while (cursor && dateSet.has(fmtDate(cursor))) {
    current += 1;
    cursor = addDays(cursor, -1);
  }

  res.json({ current, longest });
});

// GET /api/stats/calendar?year=YYYY — per-day balance for the heatmap (Feature 4)
router.get('/calendar', async (req, res) => {
  const rows = await loadAllDays();
  const year = /^\d{4}$/.test(req.query.year) ? req.query.year : null;
  const data = rows
    .filter((r) => !year || r.date.slice(0, 4) === year)
    .map((r) => ({ date: r.date, balance: round2(balanceOf(r)) }));
  res.json(data);
});

// GET /api/stats/monthly?month=YYYY-MM — monthly "wrapped" recap (Feature 5)
router.get('/monthly', async (req, res) => {
  const month = /^\d{4}-\d{2}$/.test(req.query.month)
    ? req.query.month
    : fmtDate(new Date()).slice(0, 7);

  const rows = await loadAllDays();
  const inMonth = (m) => rows.filter((r) => r.date.slice(0, 7) === m);
  const cur = inMonth(month);

  // Previous calendar month key.
  const [y, mo] = month.split('-').map(Number);
  const prevD = new Date(y, mo - 2, 1);
  const prevMonth = `${prevD.getFullYear()}-${String(prevD.getMonth() + 1).padStart(2, '0')}`;
  const prev = inMonth(prevMonth);

  const sum = (list, fn) => round2(list.reduce((s, r) => s + fn(r), 0));
  const totalIncome = sum(cur, incomeOf);
  const totalExpenses = sum(cur, expensesOf);
  const balance = round2(totalIncome - totalExpenses);

  // Top spending category this month.
  const catTotals = EXPENSE_CATEGORIES.map((c) => ({
    label: c.label,
    amount: round2(cur.reduce((s, r) => s + r[c.key], 0)),
  })).sort((a, b) => b.amount - a.amount);
  const topCategory = catTotals[0] && catTotals[0].amount > 0 ? catTotals[0] : null;

  // Best / worst day by balance.
  let best = null;
  let worst = null;
  for (const r of cur) {
    const bal = round2(balanceOf(r));
    if (best === null || bal > best.balance) best = { date: r.date, balance: bal };
    if (worst === null || bal < worst.balance) worst = { date: r.date, balance: bal };
  }

  // % change vs previous month. null = no baseline (previous month had none).
  const pctChange = (now, before) => {
    if (before === 0) return now === 0 ? 0 : null;
    return round2(((now - before) / before) * 100);
  };
  const prevIncome = sum(prev, incomeOf);
  const prevExpenses = sum(prev, expensesOf);

  res.json({
    month,
    prevMonth,
    hasData: cur.length > 0,
    totalIncome,
    totalExpenses,
    balance,
    topCategory,
    bestDay: best,
    worstDay: worst,
    daysLogged: cur.length,
    comparison: {
      prevIncome,
      prevExpenses,
      incomeChange: pctChange(totalIncome, prevIncome),
      expensesChange: pctChange(totalExpenses, prevExpenses),
    },
  });
});

export default router;
