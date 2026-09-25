// server/routes/stats.js: window shapes (day/week/month), per-user dynamic
// categories in the pie/columns, days[].amounts keyed by category id, streak,
// calendar and the monthly recap — all scoped to the caller per docs/API.md.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, stopApp, closePool, registerUser, addDaysStr, todayStr } from './helpers.js';

let ctx;

before(async () => {
  ctx = await startApp();
});

after(async () => {
  await stopApp(ctx.server);
  await closePool();
});

async function getCategory(token, kind) {
  const res = await ctx.client.get('/api/categories', { token });
  return res.body.find((c) => c.kind === kind);
}

test('GET /api/stats chart length matches the window: day=7, week=8, month=6', async () => {
  const { token } = await registerUser(ctx.client);

  const day = await ctx.client.get('/api/stats?range=day', { token });
  assert.strictEqual(day.status, 200);
  assert.strictEqual(day.body.range, 'day');
  assert.strictEqual(day.body.chart.length, 7);

  const week = await ctx.client.get('/api/stats?range=week', { token });
  assert.strictEqual(week.body.range, 'week');
  assert.strictEqual(week.body.chart.length, 8);

  const month = await ctx.client.get('/api/stats?range=month', { token });
  assert.strictEqual(month.body.range, 'month');
  assert.strictEqual(month.body.chart.length, 6);

  const invalid = await ctx.client.get('/api/stats?range=nonsense', { token });
  assert.strictEqual(invalid.status, 200);
  assert.strictEqual(invalid.body.range, 'day'); // invalid range falls back to 'day'
  assert.strictEqual(invalid.body.chart.length, 7);
});

test("GET /api/stats reflects the caller's own dynamic categories (columns/pie) and keys days[].amounts by category id", async () => {
  const { token } = await registerUser(ctx.client);
  const custom = await ctx.client.post('/api/categories', { kind: 'expense', name: 'Кава' }, { token });
  assert.strictEqual(custom.status, 201);
  const catId = custom.body.id;

  const tx = await ctx.client.post('/api/transactions', { category_id: catId, amount: 60 }, { token });
  assert.strictEqual(tx.status, 201);

  const stats = await ctx.client.get('/api/stats?range=day', { token });
  assert.strictEqual(stats.status, 200);

  const col = stats.body.columns.find((c) => c.id === catId);
  assert.ok(col);
  assert.strictEqual(col.label, 'Кава');
  assert.strictEqual(col.color, custom.body.color);
  assert.strictEqual(col.kind, 'expense');

  const pie = stats.body.categories.find((c) => c.id === catId);
  assert.ok(pie);
  assert.strictEqual(pie.label, 'Кава');
  assert.strictEqual(pie.value, 60);

  const dayRow = stats.body.days.find((d) => d.date === todayStr());
  assert.ok(dayRow);
  assert.strictEqual(dayRow.amounts[String(catId)], 60);
});

test('GET /api/stats/streak counts consecutive recorded days ending today', async () => {
  const { token } = await registerUser(ctx.client);
  const expense = await getCategory(token, 'expense');
  const yesterday = addDaysStr(new Date(), -1);
  const today = todayStr();

  await ctx.client.post('/api/transactions', { category_id: expense.id, amount: 5, date: yesterday }, { token });
  await ctx.client.post('/api/transactions', { category_id: expense.id, amount: 5, date: today }, { token });

  const streak = await ctx.client.get('/api/stats/streak', { token });
  assert.strictEqual(streak.status, 200);
  assert.strictEqual(streak.body.current, 2);
  assert.ok(streak.body.longest >= 2);
});

test('GET /api/stats/calendar?year returns one entry per recorded day, oldest first', async () => {
  const { token } = await registerUser(ctx.client);
  const expense = await getCategory(token, 'expense');
  const d1 = addDaysStr(new Date(), -2);
  const d2 = addDaysStr(new Date(), -1);
  await ctx.client.post('/api/transactions', { category_id: expense.id, amount: 10, date: d1 }, { token });
  await ctx.client.post('/api/transactions', { category_id: expense.id, amount: 10, date: d2 }, { token });

  const year = todayStr().slice(0, 4);
  const res = await ctx.client.get(`/api/stats/calendar?year=${year}`, { token });
  assert.strictEqual(res.status, 200);
  const dates = res.body.map((r) => r.date);
  const i1 = dates.indexOf(d1);
  const i2 = dates.indexOf(d2);
  assert.ok(i1 !== -1 && i2 !== -1, 'both recorded days are present');
  assert.ok(i1 < i2, 'entries are ordered oldest first');
});

test('GET /api/stats/monthly reports hasData, topCategory, daysLogged and comparison', async () => {
  const { token } = await registerUser(ctx.client);
  const income = await getCategory(token, 'income');
  const bigExpense = await ctx.client.post('/api/categories', { kind: 'expense', name: 'Оренда' }, { token });
  const smallExpense = await ctx.client.post('/api/categories', { kind: 'expense', name: 'Кава2' }, { token });
  assert.strictEqual(bigExpense.status, 201);
  assert.strictEqual(smallExpense.status, 201);

  await ctx.client.post('/api/transactions', { category_id: income.id, amount: 1000 }, { token });
  await ctx.client.post('/api/transactions', { category_id: bigExpense.body.id, amount: 400 }, { token });
  await ctx.client.post('/api/transactions', { category_id: smallExpense.body.id, amount: 50 }, { token });

  const month = todayStr().slice(0, 7);
  const res = await ctx.client.get(`/api/stats/monthly?month=${month}`, { token });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.month, month);
  assert.strictEqual(res.body.hasData, true);
  assert.strictEqual(res.body.daysLogged, 1);
  assert.strictEqual(res.body.totalIncome, 1000);
  assert.strictEqual(res.body.totalExpenses, 450);
  assert.strictEqual(res.body.balance, 550);
  assert.ok(res.body.topCategory);
  assert.strictEqual(res.body.topCategory.id, bigExpense.body.id);
  assert.strictEqual(res.body.topCategory.amount, 400);

  // A fresh user has nothing recorded in the previous month.
  assert.strictEqual(res.body.comparison.prevIncome, 0);
  assert.strictEqual(res.body.comparison.prevExpenses, 0);
  assert.strictEqual(res.body.comparison.incomeChange, null);
  assert.strictEqual(res.body.comparison.expensesChange, null);
});

test('GET /api/stats/monthly with an invalid month falls back to the current month', async () => {
  const { token } = await registerUser(ctx.client);
  const res = await ctx.client.get('/api/stats/monthly?month=not-a-month', { token });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.month, todayStr().slice(0, 7));
  assert.strictEqual(res.body.hasData, false);
  assert.strictEqual(res.body.topCategory, null);
});
