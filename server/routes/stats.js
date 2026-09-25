import { Router } from 'express';
import { and, asc, between, eq, sql } from 'drizzle-orm';
import db from '../db.js';
import { categories, days, transactions } from '../schema.js';
import { isValidDateStr, isValidMonthStr, todayStr } from '../lib/dates.js';
import { round2, toMoney } from '../lib/money.js';
import {
  categoryJoin,
  expenseSum,
  incomeSum,
  queryDaySummaries,
  rangeTotals,
  readSnapshot,
  route,
} from '../lib/ledger.js';

// Per-user statistics. Every money figure is summed by Postgres (exact numeric);
// JS only lays the SQL rows onto the continuous bucket list, labels them and
// derives averages / percentages with round2. Categories are the user's own:
// all active ones plus archived ones that still have data in the window.
const router = Router();

const RANGES = ['day', 'week', 'month'];

const MONTHS_SHORT = [
  'січ', 'лют', 'бер', 'кві', 'тра', 'чер',
  'лип', 'сер', 'вер', 'жов', 'лис', 'гру',
];

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

/** Local "today" (lib/dates.js, server clock) as a local-midnight Date. */
const todayDate = () => parseDate(todayStr());

/** Ordered, continuous chart buckets for the window, keyed like BUCKET_KEY below. */
function buildBuckets(range, today) {
  const buckets = [];
  if (range === 'week') {
    const thisMonday = mondayOf(today);
    for (let i = 7; i >= 0; i--) {
      const start = addDays(thisMonday, -7 * i);
      buckets.push({ key: fmtDate(start), label: dm(start) });
    }
    return buckets;
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
    return buckets;
  }
  // default: day — last 7 days
  for (let i = 6; i >= 0; i--) {
    const d = addDays(today, -i);
    buckets.push({ key: fmtDate(d), label: dm(d) });
  }
  return buckets;
}

// The SQL side of the same bucket keys, so each bucket is summed by Postgres.
// ::timestamp (without time zone) keeps date_trunc independent of the DB
// session's time zone; ISO weeks start on Monday, like mondayOf().
const BUCKET_KEY = {
  day: () => sql`${transactions.date}`,
  week: () => sql`date_trunc('week', ${transactions.date}::timestamp)::date`,
  month: () => sql`to_char(${transactions.date}, 'YYYY-MM')`,
};

function windowStart(range, today) {
  if (range === 'week') return addDays(mondayOf(today), -7 * 7);
  if (range === 'month') return addMonths(startOfMonth(today), -5);
  return addDays(today, -6);
}

/** Highest / lowest balance among day summaries (oldest first: ties keep the earliest). */
function bestAndWorst(rowsOldestFirst) {
  let best = null;
  let worst = null;
  for (const r of rowsOldestFirst) {
    const balance = toMoney(r.balance);
    if (best === null || balance > best.balance) best = { date: r.date, balance };
    if (worst === null || balance < worst.balance) worst = { date: r.date, balance };
  }
  return { best, worst };
}

// Active first, then the user's order — used for pie slices, table columns and ties.
const categoryOrder = () => [
  sql`${categories.archived_at} is not null`,
  asc(categories.sort_order),
  asc(categories.id),
];

// GET /api/stats?range=day|week|month
router.get(
  '/',
  route(async (req, res) => {
    const userId = req.userId;
    const range = RANGES.includes(req.query.range) ? req.query.range : 'day';

    const today = todayDate();
    const fromStr = fmtDate(windowStart(range, today));
    const toStr = fmtDate(today);

    // One snapshot so the chart, pie, totals and table all describe the same data.
    const data = await readSnapshot(async (tx) => {
      const inWindow = () => between(transactions.date, fromStr, toStr);
      const bucketKey = BUCKET_KEY[range]();

      const chartRows = await tx
        .select({ bucket: bucketKey, income: incomeSum(), expenses: expenseSum() })
        .from(transactions)
        .innerJoin(categories, categoryJoin())
        .where(and(eq(transactions.user_id, userId), inWindow()))
        .groupBy(bucketKey);

      // Both kinds: every active category + archived ones with entries in the window.
      const categoryRows = await tx
        .select({
          id: categories.id,
          kind: categories.kind,
          name: categories.name,
          color: categories.color,
          archived: sql`${categories.archived_at} is not null`,
          total: sql`coalesce(sum(${transactions.amount}), 0)`,
        })
        .from(categories)
        .leftJoin(
          transactions,
          and(
            eq(transactions.category_id, categories.id),
            eq(transactions.user_id, categories.user_id),
            inWindow()
          )
        )
        .where(eq(categories.user_id, userId))
        .groupBy(categories.id)
        .having(sql`${categories.archived_at} is null or count(${transactions.id}) > 0`)
        .orderBy(sql`${categories.kind} = 'expense'`, ...categoryOrder());

      // Per day × category, for the table's amount cells.
      const amountRows = await tx
        .select({
          date: transactions.date,
          category_id: transactions.category_id,
          amount: sql`sum(${transactions.amount})`,
        })
        .from(transactions)
        .where(and(eq(transactions.user_id, userId), inWindow()))
        .groupBy(transactions.date, transactions.category_id);

      const dayRows = await queryDaySummaries(tx, userId, { from: fromStr, to: toStr });
      const totals = await rangeTotals(tx, userId, fromStr, toStr);
      return { chartRows, categoryRows, amountRows, dayRows, totals };
    });

    const byBucket = new Map(data.chartRows.map((r) => [String(r.bucket), r]));
    const chart = buildBuckets(range, today).map((b) => {
      const row = byBucket.get(b.key);
      return { label: b.label, income: toMoney(row?.income), expenses: toMoney(row?.expenses) };
    });

    const totalIncome = toMoney(data.totals.income);
    const totalExpenses = toMoney(data.totals.expenses);

    const categoriesOut = data.categoryRows
      .filter((c) => c.kind === 'expense')
      .map((c) => {
        const value = toMoney(c.total);
        return {
          key: String(c.id),
          id: c.id,
          label: c.name,
          color: c.color,
          archived: Boolean(c.archived),
          value,
          percent: totalExpenses > 0 ? round2((value / totalExpenses) * 100) : 0,
        };
      });

    const columns = data.categoryRows.map((c) => ({
      key: String(c.id),
      id: c.id,
      kind: c.kind,
      label: c.name,
      color: c.color,
      archived: Boolean(c.archived),
    }));

    const amountsByDate = new Map();
    for (const r of data.amountRows) {
      if (!amountsByDate.has(r.date)) amountsByDate.set(r.date, {});
      amountsByDate.get(r.date)[String(r.category_id)] = toMoney(r.amount);
    }

    // dayRows are newest first (the table order); best/worst scan oldest first.
    const { best, worst } = bestAndWorst([...data.dayRows].reverse());
    const recordedDays = data.dayRows.length;

    res.json({
      range,
      from: fromStr,
      to: toStr,
      hasData: recordedDays > 0,
      chart,
      categories: categoriesOut,
      totalExpenses,
      summary: {
        avgIncome: recordedDays ? round2(totalIncome / recordedDays) : 0,
        avgExpenses: recordedDays ? round2(totalExpenses / recordedDays) : 0,
        bestDay: best,
        worstDay: worst,
      },
      columns,
      days: data.dayRows.map((d) => ({
        date: d.date,
        is_closed: d.is_closed ? 1 : 0,
        income: toMoney(d.income),
        expenses: toMoney(d.expenses),
        balance: toMoney(d.balance),
        amounts: amountsByDate.get(d.date) ?? {},
      })),
    });
  })
);

// GET /api/stats/streak — consecutive recorded days
router.get(
  '/streak',
  route(async (req, res) => {
    const rows = await db
      .select({ date: days.date })
      .from(days)
      .where(eq(days.user_id, req.userId))
      .orderBy(asc(days.date)); // oldest first, unique per user
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
    const today = todayDate();
    let cursor = null;
    if (dateSet.has(fmtDate(today))) cursor = today;
    else if (dateSet.has(fmtDate(addDays(today, -1)))) cursor = addDays(today, -1);

    let current = 0;
    while (cursor && dateSet.has(fmtDate(cursor))) {
      current += 1;
      cursor = addDays(cursor, -1);
    }

    res.json({ current, longest });
  })
);

// GET /api/stats/calendar?year=YYYY — per-day balance for the heatmap
router.get(
  '/calendar',
  route(async (req, res) => {
    const { year } = req.query;
    // Invalid / absent year → all years (as before); the range keeps it a real date.
    const valid = typeof year === 'string' && /^\d{4}$/.test(year) && isValidDateStr(`${year}-01-01`);
    const rows = await queryDaySummaries(db, req.userId, {
      ...(valid ? { from: `${year}-01-01`, to: `${year}-12-31` } : {}),
      order: 'asc',
    });
    res.json(rows.map((r) => ({ date: r.date, balance: toMoney(r.balance) })));
  })
);

// GET /api/stats/monthly?month=YYYY-MM — monthly "wrapped" recap
router.get(
  '/monthly',
  route(async (req, res) => {
    const userId = req.userId;
    const month = isValidMonthStr(req.query.month) ? req.query.month : todayStr().slice(0, 7);

    const [y, mo] = month.split('-').map(Number);
    const prevD = new Date(y, mo - 2, 1);
    const prevMonth = `${prevD.getFullYear()}-${String(prevD.getMonth() + 1).padStart(2, '0')}`;
    // Inclusive date bounds; day 0 of the next month = the month's last day.
    const monthEnd = fmtDate(new Date(y, mo, 0));
    const prevEnd = fmtDate(new Date(y, mo - 1, 0));
    const from = `${month}-01`;

    const data = await readSnapshot(async (tx) => {
      const cur = await rangeTotals(tx, userId, from, monthEnd);
      const prev = await rangeTotals(tx, userId, `${prevMonth}-01`, prevEnd);

      // Top spending category this month (ties: active first, then the user's order).
      const [top] = await tx
        .select({
          id: categories.id,
          name: categories.name,
          color: categories.color,
          archived: sql`${categories.archived_at} is not null`,
          amount: sql`sum(${transactions.amount})`,
        })
        .from(transactions)
        .innerJoin(categories, categoryJoin())
        .where(
          and(
            eq(transactions.user_id, userId),
            eq(categories.kind, 'expense'),
            between(transactions.date, from, monthEnd)
          )
        )
        .groupBy(categories.id)
        .orderBy(sql`sum(${transactions.amount}) desc`, ...categoryOrder())
        .limit(1);

      const dayRows = await queryDaySummaries(tx, userId, { from, to: monthEnd, order: 'asc' });
      return { cur, prev, top, dayRows };
    });

    const totalIncome = toMoney(data.cur.income);
    const totalExpenses = toMoney(data.cur.expenses);
    const prevIncome = toMoney(data.prev.income);
    const prevExpenses = toMoney(data.prev.expenses);
    const { best, worst } = bestAndWorst(data.dayRows);

    // % change vs previous month. null = no baseline (previous month had none).
    const pctChange = (now, before) => {
      if (before === 0) return now === 0 ? 0 : null;
      return round2(((now - before) / before) * 100);
    };

    res.json({
      month,
      prevMonth,
      hasData: data.dayRows.length > 0,
      totalIncome,
      totalExpenses,
      balance: toMoney(data.cur.balance),
      topCategory: data.top
        ? {
            id: data.top.id,
            label: data.top.name,
            color: data.top.color,
            archived: Boolean(data.top.archived),
            amount: toMoney(data.top.amount),
          }
        : null,
      bestDay: best,
      worstDay: worst,
      daysLogged: data.dayRows.length,
      comparison: {
        prevIncome,
        prevExpenses,
        incomeChange: pctChange(totalIncome, prevIncome),
        expensesChange: pctChange(totalExpenses, prevExpenses),
      },
    });
  })
);

export default router;
