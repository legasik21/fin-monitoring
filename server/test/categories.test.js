// server/routes/categories.js against docs/API.md: defaults, registration-time
// customisation, the 5/10 active limits (and archived categories not counting
// toward them), case-insensitive uniqueness, reorder, and archive semantics.
//
// CATEGORY_LIMITS / kindLimitError / DEFAULT_CATEGORY_NAMES come from
// lib/categories.js, an already-landed, orchestrator-owned shared contract —
// importing its pure constants keeps limit assertions exact without guessing
// or duplicating wording that docs/API.md deliberately leaves to the helper.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, stopApp, closePool, registerUser, uniqueEmail, MESSAGES } from './helpers.js';
import {
  CATEGORY_LIMITS,
  CATEGORY_NAME_MAX,
  DEFAULT_CATEGORY_NAMES,
  kindLimitError,
  normalizeCategoryName,
} from '../lib/categories.js';

let ctx;

before(async () => {
  ctx = await startApp();
});

after(async () => {
  await stopApp(ctx.server);
  await closePool();
});

async function listCategories(token, includeArchived = false) {
  const res = await ctx.client.get(
    `/api/categories${includeArchived ? '?include_archived=1' : ''}`,
    { token }
  );
  assert.strictEqual(res.status, 200);
  return res.body;
}

async function fillToLimit(token, kind, alreadyActive) {
  const need = CATEGORY_LIMITS[kind] - alreadyActive;
  const ids = [];
  for (let i = 0; i < need; i++) {
    const res = await ctx.client.post('/api/categories', { kind, name: `${kind}-cat-${i}` }, { token });
    assert.strictEqual(res.status, 201, `setup: create ${kind}-cat-${i} failed: ${JSON.stringify(res.body)}`);
    ids.push(res.body.id);
  }
  return ids;
}

test('defaults: a fresh user gets exactly 1 income «Дохід» + 1 expense «Витрати»', async () => {
  const { token } = await registerUser(ctx.client);
  const cats = await listCategories(token);
  assert.strictEqual(cats.length, 2);

  const income = cats.filter((c) => c.kind === 'income');
  const expense = cats.filter((c) => c.kind === 'expense');
  assert.strictEqual(income.length, 1);
  assert.strictEqual(income[0].name, DEFAULT_CATEGORY_NAMES.income);
  assert.strictEqual(income[0].archived, false);
  assert.strictEqual(expense.length, 1);
  assert.strictEqual(expense[0].name, DEFAULT_CATEGORY_NAMES.expense);
});

test('custom categories at registration replace the default for that kind only', async () => {
  const reg = await ctx.client.post('/api/auth/register', {
    email: uniqueEmail('custom-cats'),
    password: 'password123',
    categories: { income: ['ЗП – обменка', 'ЗП – поверка', 'Чайові'] },
  });
  assert.strictEqual(reg.status, 201);

  const cats = await listCategories(reg.body.token);
  const income = cats.filter((c) => c.kind === 'income').sort((a, b) => a.sort_order - b.sort_order);
  const expense = cats.filter((c) => c.kind === 'expense');
  assert.deepStrictEqual(income.map((c) => c.name), ['ЗП – обменка', 'ЗП – поверка', 'Чайові']);
  assert.strictEqual(expense.length, 1);
  assert.strictEqual(expense[0].name, DEFAULT_CATEGORY_NAMES.expense);
});

test('registration with 6 income categories -> 400', async () => {
  const res = await ctx.client.post('/api/auth/register', {
    email: uniqueEmail('six-income'),
    password: 'password123',
    categories: { income: ['a', 'b', 'c', 'd', 'e', 'f'] },
  });
  assert.strictEqual(res.status, 400);
  assert.strictEqual(res.body.error, kindLimitError('income'));
});

test('registration with duplicate names in one kind -> 400', async () => {
  const res = await ctx.client.post('/api/auth/register', {
    email: uniqueEmail('dup-cat-names'),
    password: 'password123',
    categories: { expense: ['Чайові', 'чайові'] },
  });
  assert.strictEqual(res.status, 400);
  assert.strictEqual(res.body.error, 'Категорія «чайові» вказана двічі');
});

test('create, rename, reorder and archive a category (happy paths)', async () => {
  const { token } = await registerUser(ctx.client);

  const created = await ctx.client.post('/api/categories', { kind: 'expense', name: 'Їжа' }, { token });
  assert.strictEqual(created.status, 201);
  assert.strictEqual(created.body.kind, 'expense');
  assert.strictEqual(created.body.name, 'Їжа');
  assert.strictEqual(created.body.archived, false);
  assert.strictEqual(typeof created.body.color, 'string');
  const catId = created.body.id;

  const renamed = await ctx.client.patch(`/api/categories/${catId}`, { name: 'Продукти' }, { token });
  assert.strictEqual(renamed.status, 200);
  assert.strictEqual(renamed.body.name, 'Продукти');

  const beforeOrder = await listCategories(token);
  const expenseIds = beforeOrder.filter((c) => c.kind === 'expense').map((c) => c.id);
  assert.strictEqual(expenseIds.length, 2);
  const reordered = [...expenseIds].reverse();

  const order = await ctx.client.put('/api/categories/order', { kind: 'expense', ids: reordered }, { token });
  assert.strictEqual(order.status, 200);
  assert.deepStrictEqual(order.body.map((c) => c.id), reordered);

  const archived = await ctx.client.del(`/api/categories/${catId}`, { token });
  assert.strictEqual(archived.status, 200);
  assert.strictEqual(archived.body.archived, true);

  // Archiving again is idempotent (already archived -> 200 unchanged).
  const archivedAgain = await ctx.client.del(`/api/categories/${catId}`, { token });
  assert.strictEqual(archivedAgain.status, 200);
  assert.strictEqual(archivedAgain.body.archived, true);

  const active = await listCategories(token);
  assert.ok(!active.some((c) => c.id === catId));
  const all = await listCategories(token, true);
  assert.ok(all.some((c) => c.id === catId && c.archived === true));
});

test('6th active income category is rejected', async () => {
  const { token } = await registerUser(ctx.client); // 1 default active income
  await fillToLimit(token, 'income', 1); // -> 5 active
  const res = await ctx.client.post('/api/categories', { kind: 'income', name: 'Зайвий дохід' }, { token });
  assert.strictEqual(res.status, 400);
  assert.strictEqual(res.body.error, kindLimitError('income'));
});

test('11th active expense category is rejected', async () => {
  const { token } = await registerUser(ctx.client); // 1 default active expense
  await fillToLimit(token, 'expense', 1); // -> 10 active
  const res = await ctx.client.post('/api/categories', { kind: 'expense', name: 'Зайва витрата' }, { token });
  assert.strictEqual(res.status, 400);
  assert.strictEqual(res.body.error, kindLimitError('expense'));
});

test('archived categories do not count toward the active limit', async () => {
  const { token } = await registerUser(ctx.client);
  const ids = await fillToLimit(token, 'expense', 1); // 10 active total

  const archive = await ctx.client.del(`/api/categories/${ids[0]}`, { token });
  assert.strictEqual(archive.status, 200);

  const create = await ctx.client.post('/api/categories', { kind: 'expense', name: 'Після архіву' }, { token });
  assert.strictEqual(create.status, 201);
});

test('case-insensitive duplicate active name -> 409', async () => {
  const { token } = await registerUser(ctx.client);
  const first = await ctx.client.post('/api/categories', { kind: 'expense', name: 'Їжа' }, { token });
  assert.strictEqual(first.status, 201);

  const dup = await ctx.client.post('/api/categories', { kind: 'expense', name: 'їжа' }, { token });
  assert.strictEqual(dup.status, 409);
  assert.strictEqual(dup.body.error, MESSAGES.CATEGORY_DUPLICATE);
});

test('a case-only rename of itself is allowed (not a duplicate)', async () => {
  const { token } = await registerUser(ctx.client);
  const created = await ctx.client.post('/api/categories', { kind: 'expense', name: 'їжа' }, { token });
  assert.strictEqual(created.status, 201);

  const renamed = await ctx.client.patch(`/api/categories/${created.body.id}`, { name: 'Їжа' }, { token });
  assert.strictEqual(renamed.status, 200);
  assert.strictEqual(renamed.body.name, 'Їжа');
});

test('archiving the last active category of a kind is rejected', async () => {
  const { token } = await registerUser(ctx.client); // exactly 1 active income
  const cats = await listCategories(token);
  const income = cats.find((c) => c.kind === 'income');

  const res = await ctx.client.del(`/api/categories/${income.id}`, { token });
  assert.strictEqual(res.status, 400);
  assert.strictEqual(res.body.error, MESSAGES.CATEGORY_LAST_ACTIVE);
});

test('an archived category is rejected for new transactions but stays labelled in stats and day history', async () => {
  const { token } = await registerUser(ctx.client);
  const created = await ctx.client.post('/api/categories', { kind: 'expense', name: 'Тимчасова' }, { token });
  assert.strictEqual(created.status, 201);
  const catId = created.body.id;

  const tx = await ctx.client.post('/api/transactions', { category_id: catId, amount: 42 }, { token });
  assert.strictEqual(tx.status, 201);

  const archive = await ctx.client.del(`/api/categories/${catId}`, { token });
  assert.strictEqual(archive.status, 200);

  const blocked = await ctx.client.post('/api/transactions', { category_id: catId, amount: 5 }, { token });
  assert.strictEqual(blocked.status, 400);
  assert.strictEqual(blocked.body.error, MESSAGES.CATEGORY_ARCHIVED_FOR_TX);

  const date = tx.body.transaction.date;
  const day = await ctx.client.get(`/api/days/${date}`, { token });
  assert.strictEqual(day.status, 200);
  const entry = day.body.transactions.find((t) => t.id === tx.body.transaction.id);
  assert.ok(entry, 'archived category transaction still listed on its day');
  assert.strictEqual(entry.category.archived, true);

  const stats = await ctx.client.get('/api/stats?range=day', { token });
  assert.strictEqual(stats.status, 200);
  const col = stats.body.columns.find((c) => c.id === catId);
  assert.ok(col, 'archived category still present as a stats column');
  assert.strictEqual(col.archived, true);
  const pie = stats.body.categories.find((c) => c.id === catId);
  assert.ok(pie, 'archived category still present in the expense pie');
  assert.strictEqual(pie.archived, true);
  assert.strictEqual(pie.value, 42);
});

test('PUT /api/categories/order with a foreign id -> 404', async () => {
  const { token: tokenA } = await registerUser(ctx.client);
  const { token: tokenB } = await registerUser(ctx.client);
  const expenseB = (await listCategories(tokenB)).find((c) => c.kind === 'expense');

  const res = await ctx.client.put(
    '/api/categories/order',
    { kind: 'expense', ids: [expenseB.id] },
    { token: tokenA }
  );
  assert.strictEqual(res.status, 404);
  assert.strictEqual(res.body.error, MESSAGES.CATEGORY_NOT_FOUND);
});

test('PUT /api/categories/order with a set that is not exactly the active categories -> 400', async () => {
  const { token } = await registerUser(ctx.client);
  const extra = await ctx.client.post('/api/categories', { kind: 'expense', name: 'Друга витрата' }, { token });
  assert.strictEqual(extra.status, 201);
  const expenseIds = (await listCategories(token)).filter((c) => c.kind === 'expense').map((c) => c.id);
  assert.strictEqual(expenseIds.length, 2);

  const res = await ctx.client.put(
    '/api/categories/order',
    { kind: 'expense', ids: [expenseIds[0]] }, // missing one id
    { token }
  );
  assert.strictEqual(res.status, 400);
  assert.strictEqual(res.body.error, MESSAGES.CATEGORY_ORDER_ERROR);
});

test('an invalid kind -> 400 on POST /api/categories and PUT /api/categories/order', async () => {
  const { token } = await registerUser(ctx.client);

  const create = await ctx.client.post('/api/categories', { kind: 'bogus', name: 'Щось' }, { token });
  assert.strictEqual(create.status, 400);
  assert.strictEqual(create.body.error, MESSAGES.CATEGORY_KIND_ERROR);

  const order = await ctx.client.put('/api/categories/order', { kind: 'bogus', ids: [] }, { token });
  assert.strictEqual(order.status, 400);
  assert.strictEqual(order.body.error, MESSAGES.CATEGORY_KIND_ERROR);
});

test('a whitespace-only name is rejected on create and rename', async () => {
  const { token } = await registerUser(ctx.client);
  const { error } = normalizeCategoryName('   ');

  const created = await ctx.client.post('/api/categories', { kind: 'expense', name: '   ' }, { token });
  assert.strictEqual(created.status, 400);
  assert.strictEqual(created.body.error, error);

  const real = await ctx.client.post('/api/categories', { kind: 'expense', name: 'Справжня назва' }, { token });
  assert.strictEqual(real.status, 201);
  const renamed = await ctx.client.patch(`/api/categories/${real.body.id}`, { name: '   ' }, { token });
  assert.strictEqual(renamed.status, 400);
  assert.strictEqual(renamed.body.error, error);
});

test('a name of 51 code points is rejected on create and rename with the length-limit message', async () => {
  const { token } = await registerUser(ctx.client);
  const tooLong = 'а'.repeat(CATEGORY_NAME_MAX + 1);
  assert.strictEqual([...tooLong].length, CATEGORY_NAME_MAX + 1);
  const { error } = normalizeCategoryName(tooLong);

  const created = await ctx.client.post('/api/categories', { kind: 'expense', name: tooLong }, { token });
  assert.strictEqual(created.status, 400);
  assert.strictEqual(created.body.error, error);

  const real = await ctx.client.post('/api/categories', { kind: 'expense', name: 'Ще одна назва' }, { token });
  assert.strictEqual(real.status, 201);
  const renamed = await ctx.client.patch(`/api/categories/${real.body.id}`, { name: tooLong }, { token });
  assert.strictEqual(renamed.status, 400);
  assert.strictEqual(renamed.body.error, error);
});

test('a name of exactly 50 code points including an emoji is accepted on create and rename', async () => {
  const { token } = await registerUser(ctx.client);
  const name = `😀${'б'.repeat(CATEGORY_NAME_MAX - 1)}`;
  assert.strictEqual([...name].length, CATEGORY_NAME_MAX);

  const created = await ctx.client.post('/api/categories', { kind: 'expense', name }, { token });
  assert.strictEqual(created.status, 201);
  assert.strictEqual(created.body.name, name);

  const other = await ctx.client.post('/api/categories', { kind: 'expense', name: 'Проміжна назва' }, { token });
  assert.strictEqual(other.status, 201);
  const renameTo = `😀${'в'.repeat(CATEGORY_NAME_MAX - 1)}`;
  const renamed = await ctx.client.patch(`/api/categories/${other.body.id}`, { name: renameTo }, { token });
  assert.strictEqual(renamed.status, 200);
  assert.strictEqual(renamed.body.name, renameTo);
});
