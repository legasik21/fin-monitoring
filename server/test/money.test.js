// Exact-money guarantees from docs/API.md §"Money": 0.1 + 0.2 must equal 0.3
// exactly (never 0.30000000000000004) everywhere it is reported, because sums
// run in SQL on numeric(14,2), not by float accumulation in JS. Also covers
// the decimal-comma input format ("12,5").
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  startApp,
  stopApp,
  closePool,
  registerUser,
  issueQuickAddKey,
  addDaysStr,
} from './helpers.js';

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

test('0.1 + 0.2 sums to exactly 0.3 in every response that reports it', async () => {
  const { token } = await registerUser(ctx.client);
  const expense = await getCategory(token, 'expense');
  const date = addDaysStr(new Date(), -10);

  const first = await ctx.client.post('/api/transactions', { category_id: expense.id, amount: 0.1, date }, { token });
  assert.strictEqual(first.status, 201);
  assert.strictEqual(first.body.day.expenses, 0.1);

  const second = await ctx.client.post('/api/transactions', { category_id: expense.id, amount: 0.2, date }, { token });
  assert.strictEqual(second.status, 201);
  assert.strictEqual(second.body.day.expenses, 0.3); // the POST response's `day`

  const day = await ctx.client.get(`/api/days/${date}`, { token });
  assert.strictEqual(day.body.expenses, 0.3); // GET /api/days/:date

  const days = await ctx.client.get('/api/days', { token });
  const row = days.body.find((d) => d.date === date);
  assert.ok(row, 'the day appears in GET /api/days');
  assert.strictEqual(row.expenses, 0.3); // GET /api/days

  const stats = await ctx.client.get('/api/stats?range=month', { token });
  assert.strictEqual(stats.status, 200);
  assert.strictEqual(stats.body.totalExpenses, 0.3); // /api/stats totalExpenses
  const statsDay = stats.body.days.find((d) => d.date === date);
  assert.ok(statsDay, 'the day appears in /api/stats days[]');
  assert.strictEqual(statsDay.expenses, 0.3); // /api/stats day row

  const month = date.slice(0, 7);
  const monthly = await ctx.client.get(`/api/stats/monthly?month=${month}`, { token });
  assert.strictEqual(monthly.status, 200);
  assert.strictEqual(monthly.body.totalExpenses, 0.3); // /api/stats/monthly totalExpenses
});

test('quick-add totals also sum 0.1 + 0.2 to exactly 0.3', async () => {
  const { token } = await registerUser(ctx.client);
  const key = await issueQuickAddKey(ctx.client, token);
  const expense = await getCategory(token, 'expense');

  const first = await ctx.client.post('/api/quick-add', { category: expense.id, amount: 0.1 }, { apiKey: key });
  assert.strictEqual(first.status, 200);
  assert.strictEqual(first.body.totals.expenses, 0.1);

  const second = await ctx.client.post('/api/quick-add', { category: expense.id, amount: 0.2 }, { apiKey: key });
  assert.strictEqual(second.status, 200);
  assert.strictEqual(second.body.totals.expenses, 0.3);
});

test('a decimal-comma string "12,5" is accepted and stored as 12.5', async () => {
  const { token } = await registerUser(ctx.client);
  const expense = await getCategory(token, 'expense');
  const res = await ctx.client.post('/api/transactions', { category_id: expense.id, amount: '12,5' }, { token });
  assert.strictEqual(res.status, 201);
  assert.strictEqual(res.body.transaction.amount, 12.5);
});
