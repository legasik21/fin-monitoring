// server/routes/quick-add.js (X-API-Key auth, no JWT) plus the two "undo last"
// routes (DELETE /api/quick-add/last and its JWT twin
// DELETE /api/transactions/last-quick-add), per docs/API.md.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  startApp,
  stopApp,
  closePool,
  registerUser,
  issueQuickAddKey,
  todayStr,
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

test('generating a quick-add key returns 201 "fmq_…" and flips has_quick_add_key', async () => {
  const { token } = await registerUser(ctx.client);
  const res = await ctx.client.post('/api/auth/quick-add-key', undefined, { token });
  assert.strictEqual(res.status, 201);
  assert.strictEqual(typeof res.body.key, 'string');
  assert.ok(res.body.key.startsWith('fmq_'));

  const me = await ctx.client.get('/api/auth/me', { token });
  assert.strictEqual(me.body.has_quick_add_key, true);
});

test('POST /api/quick-add matches an active category by name, case-insensitively', async () => {
  const { token } = await registerUser(ctx.client);
  const key = await issueQuickAddKey(ctx.client, token);
  const income = await getCategory(token, 'income'); // "Дохід"

  const res = await ctx.client.post(
    '/api/quick-add',
    { category: income.name.toUpperCase(), amount: 300 },
    { apiKey: key }
  );
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.ok, true);
  assert.strictEqual(res.body.date, todayStr());
  assert.strictEqual(res.body.transaction.source, 'quick_add');
  assert.strictEqual(res.body.transaction.category.id, income.id);
  assert.strictEqual(res.body.totals.income, 300);
});

test('POST /api/quick-add matches a category by numeric id', async () => {
  const { token } = await registerUser(ctx.client);
  const key = await issueQuickAddKey(ctx.client, token);
  const expense = await getCategory(token, 'expense');

  const res = await ctx.client.post('/api/quick-add', { category: expense.id, amount: 25 }, { apiKey: key });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.transaction.category.id, expense.id);
});

test('missing or invalid X-API-Key -> 401', async () => {
  const missing = await ctx.client.post('/api/quick-add', { category: 1, amount: 10 });
  assert.strictEqual(missing.status, 401);
  assert.strictEqual(missing.body.error, MESSAGES.QUICK_ADD_KEY_INVALID);

  const wrong = await ctx.client.post(
    '/api/quick-add',
    { category: 1, amount: 10 },
    { apiKey: 'fmq_not-a-real-key' }
  );
  assert.strictEqual(wrong.status, 401);
  assert.strictEqual(wrong.body.error, MESSAGES.QUICK_ADD_KEY_INVALID);
});

test('regenerating the key invalidates the old one', async () => {
  const { token } = await registerUser(ctx.client);
  const oldKey = await issueQuickAddKey(ctx.client, token);
  const newKey = await issueQuickAddKey(ctx.client, token);
  assert.notStrictEqual(oldKey, newKey);

  const withOld = await ctx.client.post('/api/quick-add', { category: 1, amount: 10 }, { apiKey: oldKey });
  assert.strictEqual(withOld.status, 401);
  assert.strictEqual(withOld.body.error, MESSAGES.QUICK_ADD_KEY_INVALID);

  const expense = await getCategory(token, 'expense');
  const withNew = await ctx.client.post('/api/quick-add', { category: expense.id, amount: 10 }, { apiKey: newKey });
  assert.strictEqual(withNew.status, 200);
});

test('a revoked key is rejected', async () => {
  const { token } = await registerUser(ctx.client);
  const key = await issueQuickAddKey(ctx.client, token);
  const revoke = await ctx.client.del('/api/auth/quick-add-key', { token });
  assert.strictEqual(revoke.status, 200);
  assert.deepStrictEqual(revoke.body, { ok: true });

  const res = await ctx.client.post('/api/quick-add', { category: 1, amount: 10 }, { apiKey: key });
  assert.strictEqual(res.status, 401);
  assert.strictEqual(res.body.error, MESSAGES.QUICK_ADD_KEY_INVALID);
});

test('an unknown category name/id -> 400 Невідома категорія', async () => {
  const { token } = await registerUser(ctx.client);
  const key = await issueQuickAddKey(ctx.client, token);
  const res = await ctx.client.post('/api/quick-add', { category: 'Немає такої категорії', amount: 10 }, { apiKey: key });
  assert.strictEqual(res.status, 400);
  assert.strictEqual(res.body.error, MESSAGES.QUICK_ADD_UNKNOWN_CATEGORY);
});

test('an archived category -> 400 Невідома категорія', async () => {
  const { token } = await registerUser(ctx.client);
  const key = await issueQuickAddKey(ctx.client, token);
  const created = await ctx.client.post('/api/categories', { kind: 'expense', name: 'Скоро архів' }, { token });
  assert.strictEqual(created.status, 201);
  const archive = await ctx.client.del(`/api/categories/${created.body.id}`, { token });
  assert.strictEqual(archive.status, 200);

  const res = await ctx.client.post('/api/quick-add', { category: 'Скоро архів', amount: 10 }, { apiKey: key });
  assert.strictEqual(res.status, 400);
  assert.strictEqual(res.body.error, MESSAGES.QUICK_ADD_UNKNOWN_CATEGORY);
});

test('an ambiguous name across kinds requires `kind` to disambiguate', async () => {
  const { token } = await registerUser(ctx.client);
  const key = await issueQuickAddKey(ctx.client, token);
  const incomeCat = await ctx.client.post('/api/categories', { kind: 'income', name: 'Спільна назва' }, { token });
  const expenseCat = await ctx.client.post('/api/categories', { kind: 'expense', name: 'Спільна назва' }, { token });
  assert.strictEqual(incomeCat.status, 201);
  assert.strictEqual(expenseCat.status, 201);

  const ambiguous = await ctx.client.post('/api/quick-add', { category: 'Спільна назва', amount: 5 }, { apiKey: key });
  assert.strictEqual(ambiguous.status, 400);
  assert.strictEqual(ambiguous.body.error, MESSAGES.QUICK_ADD_AMBIGUOUS);

  const resolved = await ctx.client.post(
    '/api/quick-add',
    { category: 'Спільна назва', amount: 5, kind: 'expense' },
    { apiKey: key }
  );
  assert.strictEqual(resolved.status, 200);
  assert.strictEqual(resolved.body.transaction.category.id, expenseCat.body.id);
});

test('undo-last removes only the most recent quick-add of today', async () => {
  const { token } = await registerUser(ctx.client);
  const key = await issueQuickAddKey(ctx.client, token);
  const expense = await getCategory(token, 'expense');

  const manual = await ctx.client.post('/api/transactions', { category_id: expense.id, amount: 1 }, { token });
  assert.strictEqual(manual.status, 201);
  const qa1 = await ctx.client.post('/api/quick-add', { category: expense.id, amount: 2 }, { apiKey: key });
  assert.strictEqual(qa1.status, 200);
  const qa2 = await ctx.client.post('/api/quick-add', { category: expense.id, amount: 3 }, { apiKey: key });
  assert.strictEqual(qa2.status, 200);

  const undo = await ctx.client.del('/api/quick-add/last', { apiKey: key });
  assert.strictEqual(undo.status, 200);
  assert.strictEqual(undo.body.removed.id, qa2.body.transaction.id);
  assert.strictEqual(undo.body.date, todayStr());

  const day = await ctx.client.get(`/api/days/${todayStr()}`, { token });
  assert.strictEqual(day.status, 200);
  const ids = day.body.transactions.map((t) => t.id);
  assert.ok(ids.includes(manual.body.transaction.id), 'the manual entry stays');
  assert.ok(ids.includes(qa1.body.transaction.id), 'the earlier quick-add stays');
  assert.ok(!ids.includes(qa2.body.transaction.id), 'only the latest quick-add is undone');
});

test('undo-last with nothing to undo today -> 404', async () => {
  const { token } = await registerUser(ctx.client);
  const key = await issueQuickAddKey(ctx.client, token);
  const res = await ctx.client.del('/api/quick-add/last', { apiKey: key });
  assert.strictEqual(res.status, 404);
  assert.strictEqual(res.body.error, MESSAGES.QUICK_ADD_NONE_TODAY);
});

test('DELETE /api/transactions/last-quick-add (JWT) undoes the same latest-quick-add-of-today', async () => {
  const { token } = await registerUser(ctx.client);
  const key = await issueQuickAddKey(ctx.client, token);
  const expense = await getCategory(token, 'expense');
  const qa = await ctx.client.post('/api/quick-add', { category: expense.id, amount: 7 }, { apiKey: key });
  assert.strictEqual(qa.status, 200);

  const undo = await ctx.client.del('/api/transactions/last-quick-add', { token });
  assert.strictEqual(undo.status, 200);
  assert.strictEqual(undo.body.removed.id, qa.body.transaction.id);

  const none = await ctx.client.del('/api/transactions/last-quick-add', { token });
  assert.strictEqual(none.status, 404);
  assert.strictEqual(none.body.error, MESSAGES.QUICK_ADD_NONE_TODAY);
});
