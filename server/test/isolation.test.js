// Tenant isolation, checked across every resource type per docs/API.md
// ("An id in the URL or body that does not exist or belongs to another user ->
// 404 ... never 403 — do not reveal existence"). This is the single most
// important guarantee of the multi-user rebuild, so it gets its own file
// covering categories, transactions, goals, days, list/stats leakage, and
// quick-add's per-key scoping.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  startApp,
  stopApp,
  closePool,
  registerUser,
  issueQuickAddKey,
  addDaysStr,
  MESSAGES,
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

test("user B gets 404 on user A's category (GET/PATCH/DELETE) and cannot spend it via POST /api/transactions", async () => {
  const { token: tokenA } = await registerUser(ctx.client);
  const { token: tokenB } = await registerUser(ctx.client);
  const catA = await ctx.client.post('/api/categories', { kind: 'expense', name: 'Категорія A' }, { token: tokenA });
  assert.strictEqual(catA.status, 201);
  const id = catA.body.id;

  const get = await ctx.client.get(`/api/categories/${id}`, { token: tokenB });
  assert.strictEqual(get.status, 404);
  assert.strictEqual(get.body.error, MESSAGES.CATEGORY_NOT_FOUND);

  const patch = await ctx.client.patch(`/api/categories/${id}`, { name: 'Хочу перейменувати' }, { token: tokenB });
  assert.strictEqual(patch.status, 404);
  assert.strictEqual(patch.body.error, MESSAGES.CATEGORY_NOT_FOUND);

  const del = await ctx.client.del(`/api/categories/${id}`, { token: tokenB });
  assert.strictEqual(del.status, 404);
  assert.strictEqual(del.body.error, MESSAGES.CATEGORY_NOT_FOUND);

  const spend = await ctx.client.post('/api/transactions', { category_id: id, amount: 10 }, { token: tokenB });
  assert.strictEqual(spend.status, 404);
  assert.strictEqual(spend.body.error, MESSAGES.CATEGORY_NOT_FOUND);
});

test("user B gets 404 on user A's transaction (GET/PATCH/DELETE)", async () => {
  const { token: tokenA } = await registerUser(ctx.client);
  const { token: tokenB } = await registerUser(ctx.client);
  const expenseA = await getCategory(tokenA, 'expense');
  const txA = await ctx.client.post('/api/transactions', { category_id: expenseA.id, amount: 15 }, { token: tokenA });
  assert.strictEqual(txA.status, 201);
  const id = txA.body.transaction.id;

  const get = await ctx.client.get(`/api/transactions/${id}`, { token: tokenB });
  assert.strictEqual(get.status, 404);
  assert.strictEqual(get.body.error, MESSAGES.TRANSACTION_NOT_FOUND);

  const patch = await ctx.client.patch(`/api/transactions/${id}`, { amount: 20 }, { token: tokenB });
  assert.strictEqual(patch.status, 404);
  assert.strictEqual(patch.body.error, MESSAGES.TRANSACTION_NOT_FOUND);

  const del = await ctx.client.del(`/api/transactions/${id}`, { token: tokenB });
  assert.strictEqual(del.status, 404);
  assert.strictEqual(del.body.error, MESSAGES.TRANSACTION_NOT_FOUND);
});

test("user B gets 404 on user A's goal (GET/PATCH/DELETE)", async () => {
  const { token: tokenA } = await registerUser(ctx.client);
  const { token: tokenB } = await registerUser(ctx.client);
  const goalA = await ctx.client.post('/api/goals', { title: 'Ціль A', target_amount: 100 }, { token: tokenA });
  assert.strictEqual(goalA.status, 201);
  const id = goalA.body.id;

  const get = await ctx.client.get(`/api/goals/${id}`, { token: tokenB });
  assert.strictEqual(get.status, 404);
  assert.strictEqual(get.body.error, MESSAGES.GOAL_NOT_FOUND);

  const patch = await ctx.client.patch(`/api/goals/${id}`, { contribute: 10 }, { token: tokenB });
  assert.strictEqual(patch.status, 404);
  assert.strictEqual(patch.body.error, MESSAGES.GOAL_NOT_FOUND);

  const del = await ctx.client.del(`/api/goals/${id}`, { token: tokenB });
  assert.strictEqual(del.status, 404);
  assert.strictEqual(del.body.error, MESSAGES.GOAL_NOT_FOUND);
});

test("user B gets 404 on GET /api/days/:date for one of user A's dates", async () => {
  const { token: tokenA } = await registerUser(ctx.client);
  const { token: tokenB } = await registerUser(ctx.client);
  const expenseA = await getCategory(tokenA, 'expense');
  const date = addDaysStr(new Date(), -9);
  await ctx.client.post('/api/transactions', { category_id: expenseA.id, amount: 15, date }, { token: tokenA });

  const res = await ctx.client.get(`/api/days/${date}`, { token: tokenB });
  assert.strictEqual(res.status, 404);
});

test("user B's lists and stats never contain user A's data", async () => {
  const { token: tokenA } = await registerUser(ctx.client);
  const { token: tokenB } = await registerUser(ctx.client);
  const expenseA = await getCategory(tokenA, 'expense');
  await ctx.client.post('/api/transactions', { category_id: expenseA.id, amount: 999 }, { token: tokenA });
  await ctx.client.post('/api/goals', { title: 'Таємна ціль A', target_amount: 500 }, { token: tokenA });

  const catsB = await ctx.client.get('/api/categories', { token: tokenB });
  assert.strictEqual(catsB.status, 200);
  assert.ok(!catsB.body.some((c) => c.id === expenseA.id));

  const goalsB = await ctx.client.get('/api/goals', { token: tokenB });
  assert.strictEqual(goalsB.status, 200);
  assert.ok(!goalsB.body.some((g) => g.title === 'Таємна ціль A'));

  const statsB = await ctx.client.get('/api/stats?range=day', { token: tokenB });
  assert.strictEqual(statsB.status, 200);
  assert.strictEqual(statsB.body.totalExpenses, 0);
  assert.ok(!statsB.body.columns.some((c) => c.id === expenseA.id));

  const daysB = await ctx.client.get('/api/days', { token: tokenB });
  assert.strictEqual(daysB.status, 200);
  assert.strictEqual(daysB.body.length, 0);
});

test("quick-add with B's key cannot use A's category name or id", async () => {
  const { token: tokenA } = await registerUser(ctx.client);
  const { token: tokenB } = await registerUser(ctx.client);
  const keyB = await issueQuickAddKey(ctx.client, tokenB);
  const uniqueName = `Категорія лише А ${Date.now()}`;
  const catA = await ctx.client.post('/api/categories', { kind: 'expense', name: uniqueName }, { token: tokenA });
  assert.strictEqual(catA.status, 201);

  const byId = await ctx.client.post('/api/quick-add', { category: catA.body.id, amount: 5 }, { apiKey: keyB });
  assert.strictEqual(byId.status, 400);
  assert.strictEqual(byId.body.error, MESSAGES.QUICK_ADD_UNKNOWN_CATEGORY);

  const byName = await ctx.client.post('/api/quick-add', { category: uniqueName, amount: 5 }, { apiKey: keyB });
  assert.strictEqual(byName.status, 400);
  assert.strictEqual(byName.body.error, MESSAGES.QUICK_ADD_UNKNOWN_CATEGORY);
});
