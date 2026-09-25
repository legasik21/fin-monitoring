// The ledger: server/routes/transactions.js + server/routes/days.js + the day
// upsert/close/cleanup rules in server/lib/ledger.js, exercised only through
// the public HTTP contract in docs/API.md.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, stopApp, closePool, registerUser, MESSAGES, addDaysStr } from './helpers.js';

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
  assert.strictEqual(res.status, 200);
  return res.body.find((c) => c.kind === kind);
}

test('adding transactions updates day totals and lists them on GET /api/days/:date', async () => {
  const { token } = await registerUser(ctx.client);
  const income = await getCategory(token, 'income');
  const expense = await getCategory(token, 'expense');
  const date = addDaysStr(new Date(), -3);

  const inc = await ctx.client.post('/api/transactions', { category_id: income.id, amount: 500, date }, { token });
  assert.strictEqual(inc.status, 201);
  assert.strictEqual(inc.body.day.income, 500);
  assert.strictEqual(inc.body.day.expenses, 0);
  assert.strictEqual(inc.body.day.balance, 500);

  const exp = await ctx.client.post(
    '/api/transactions',
    { category_id: expense.id, amount: 120, date, note: 'тест' },
    { token }
  );
  assert.strictEqual(exp.status, 201);
  assert.strictEqual(exp.body.day.income, 500);
  assert.strictEqual(exp.body.day.expenses, 120);
  assert.strictEqual(exp.body.day.balance, 380);
  assert.strictEqual(exp.body.transaction.note, 'тест');
  assert.strictEqual(exp.body.transaction.source, 'manual');

  const day = await ctx.client.get(`/api/days/${date}`, { token });
  assert.strictEqual(day.status, 200);
  assert.strictEqual(day.body.transactions.length, 2);
  assert.strictEqual(day.body.income, 500);
  assert.strictEqual(day.body.expenses, 120);
  assert.strictEqual(day.body.balance, 380);
});

test('deleting a transaction updates day totals', async () => {
  const { token } = await registerUser(ctx.client);
  const expense = await getCategory(token, 'expense');
  const date = addDaysStr(new Date(), -4);

  await ctx.client.post('/api/transactions', { category_id: expense.id, amount: 100, date }, { token });
  const b = await ctx.client.post('/api/transactions', { category_id: expense.id, amount: 50, date }, { token });
  assert.strictEqual(b.body.day.expenses, 150);

  const del = await ctx.client.del(`/api/transactions/${b.body.transaction.id}`, { token });
  assert.strictEqual(del.status, 200);
  assert.strictEqual(del.body.day.expenses, 100);
});

test('deleting the last entry of an open day removes the day row', async () => {
  const { token } = await registerUser(ctx.client);
  const expense = await getCategory(token, 'expense');
  const date = addDaysStr(new Date(), -5);

  const created = await ctx.client.post('/api/transactions', { category_id: expense.id, amount: 10, date }, { token });
  assert.strictEqual(created.status, 201);

  const del = await ctx.client.del(`/api/transactions/${created.body.transaction.id}`, { token });
  assert.strictEqual(del.status, 200);
  assert.strictEqual(del.body.day, null);

  const day = await ctx.client.get(`/api/days/${date}`, { token });
  assert.strictEqual(day.status, 404);
  assert.strictEqual(day.body.error, MESSAGES.TRANSACTION_NOT_FOUND);
});

test('adding an entry to a closed day reopens it', async () => {
  const { token } = await registerUser(ctx.client);
  const expense = await getCategory(token, 'expense');
  const date = addDaysStr(new Date(), -6);

  const close = await ctx.client.patch(`/api/days/${date}/close`, undefined, { token });
  assert.strictEqual(close.status, 200);
  assert.strictEqual(close.body.is_closed, 1);

  const add = await ctx.client.post('/api/transactions', { category_id: expense.id, amount: 30, date }, { token });
  assert.strictEqual(add.status, 201);
  assert.strictEqual(add.body.day.is_closed, 0);

  const day = await ctx.client.get(`/api/days/${date}`, { token });
  assert.strictEqual(day.body.is_closed, 0);
});

test('PATCH /api/days/:date/close on a date with no entries creates a closed recorded day', async () => {
  const { token } = await registerUser(ctx.client);
  const date = addDaysStr(new Date(), -7);

  const close = await ctx.client.patch(`/api/days/${date}/close`, undefined, { token });
  assert.strictEqual(close.status, 200);
  assert.strictEqual(close.body.is_closed, 1);
  assert.strictEqual(close.body.income, 0);
  assert.strictEqual(close.body.expenses, 0);

  const day = await ctx.client.get(`/api/days/${date}`, { token });
  assert.strictEqual(day.status, 200);
  assert.strictEqual(day.body.is_closed, 1);
  assert.deepStrictEqual(day.body.transactions, []);
});

test('PATCH /api/transactions/:id updates amount and note', async () => {
  const { token } = await registerUser(ctx.client);
  const expense = await getCategory(token, 'expense');
  const date = addDaysStr(new Date(), -8);
  const created = await ctx.client.post('/api/transactions', { category_id: expense.id, amount: 20, date }, { token });

  const patched = await ctx.client.patch(
    `/api/transactions/${created.body.transaction.id}`,
    { amount: 35.5, note: 'оновлено' },
    { token }
  );
  assert.strictEqual(patched.status, 200);
  assert.strictEqual(patched.body.transaction.amount, 35.5);
  assert.strictEqual(patched.body.transaction.note, 'оновлено');
  assert.strictEqual(patched.body.day.expenses, 35.5);
});

test('note longer than 200 code points -> 400', async () => {
  const { token } = await registerUser(ctx.client);
  const expense = await getCategory(token, 'expense');
  const res = await ctx.client.post(
    '/api/transactions',
    { category_id: expense.id, amount: 10, note: 'а'.repeat(201) },
    { token }
  );
  assert.strictEqual(res.status, 400);
  assert.strictEqual(res.body.error, MESSAGES.NOTE_ERROR);
});

test('amount 0, negative, or non-numeric -> 400 Сума має бути додатнім числом', async () => {
  const { token } = await registerUser(ctx.client);
  const expense = await getCategory(token, 'expense');
  for (const amount of [0, -5, 'abc']) {
    const res = await ctx.client.post('/api/transactions', { category_id: expense.id, amount }, { token });
    assert.strictEqual(res.status, 400, `amount=${JSON.stringify(amount)}`);
    assert.strictEqual(res.body.error, MESSAGES.MONEY_ERROR);
  }
});

test('an invalid calendar date -> 400', async () => {
  const { token } = await registerUser(ctx.client);
  const expense = await getCategory(token, 'expense');
  const res = await ctx.client.post(
    '/api/transactions',
    { category_id: expense.id, amount: 10, date: '2026-02-30' },
    { token }
  );
  assert.strictEqual(res.status, 400);
  assert.strictEqual(res.body.error, MESSAGES.INVALID_DATE);
});

test('a non-integer transaction id -> 400 Невірний ідентифікатор', async () => {
  const { token } = await registerUser(ctx.client);
  const res = await ctx.client.get('/api/transactions/12.5', { token });
  assert.strictEqual(res.status, 400);
  assert.strictEqual(res.body.error, MESSAGES.INVALID_ID);
});
