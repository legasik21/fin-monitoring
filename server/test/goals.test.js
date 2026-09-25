// server/routes/goals.js: CRUD, contribution/achievement, and exact-money
// contributions per docs/API.md ("unchanged behaviour, now per user").
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, stopApp, closePool, registerUser, MESSAGES } from './helpers.js';

let ctx;

before(async () => {
  ctx = await startApp();
});

after(async () => {
  await stopApp(ctx.server);
  await closePool();
});

test('create, list, get, contribute, achieve and delete a goal', async () => {
  const { token } = await registerUser(ctx.client);

  const created = await ctx.client.post('/api/goals', { title: 'Відпустка', target_amount: 1000 }, { token });
  assert.strictEqual(created.status, 201);
  assert.strictEqual(created.body.title, 'Відпустка');
  assert.strictEqual(created.body.target_amount, 1000);
  assert.strictEqual(created.body.current_amount, 0);
  assert.strictEqual(created.body.achieved, false);
  assert.strictEqual(created.body.percent, 0);
  const goalId = created.body.id;

  const list = await ctx.client.get('/api/goals', { token });
  assert.strictEqual(list.status, 200);
  assert.ok(list.body.some((g) => g.id === goalId));

  const got = await ctx.client.get(`/api/goals/${goalId}`, { token });
  assert.strictEqual(got.status, 200);
  assert.strictEqual(got.body.id, goalId);

  const contributed = await ctx.client.patch(`/api/goals/${goalId}`, { contribute: 400 }, { token });
  assert.strictEqual(contributed.status, 200);
  assert.strictEqual(contributed.body.current_amount, 400);
  assert.strictEqual(contributed.body.achieved, false);

  // achieved flips true when current >= target (a Postgres generated column).
  const achieved = await ctx.client.patch(`/api/goals/${goalId}`, { contribute: 600 }, { token });
  assert.strictEqual(achieved.status, 200);
  assert.strictEqual(achieved.body.current_amount, 1000);
  assert.strictEqual(achieved.body.achieved, true);
  assert.strictEqual(achieved.body.percent, 100);

  const del = await ctx.client.del(`/api/goals/${goalId}`, { token });
  assert.strictEqual(del.status, 200);
  assert.deepStrictEqual(del.body, { ok: true });

  const gone = await ctx.client.get(`/api/goals/${goalId}`, { token });
  assert.strictEqual(gone.status, 404);
  assert.strictEqual(gone.body.error, MESSAGES.GOAL_NOT_FOUND);
});

test('contributions sum exactly in SQL: 0.1 + 0.2 -> current_amount 0.3', async () => {
  const { token } = await registerUser(ctx.client);
  const created = await ctx.client.post('/api/goals', { title: 'Точність', target_amount: 100 }, { token });
  assert.strictEqual(created.status, 201);
  const goalId = created.body.id;

  const first = await ctx.client.patch(`/api/goals/${goalId}`, { contribute: 0.1 }, { token });
  assert.strictEqual(first.status, 200);
  assert.strictEqual(first.body.current_amount, 0.1);

  const second = await ctx.client.patch(`/api/goals/${goalId}`, { contribute: 0.2 }, { token });
  assert.strictEqual(second.status, 200);
  assert.strictEqual(second.body.current_amount, 0.3);
});

test('an invalid contribute amount -> 400', async () => {
  const { token } = await registerUser(ctx.client);
  const created = await ctx.client.post('/api/goals', { title: 'Тест', target_amount: 50 }, { token });
  const goalId = created.body.id;

  for (const contribute of [0, -1, 'abc']) {
    const res = await ctx.client.patch(`/api/goals/${goalId}`, { contribute }, { token });
    assert.strictEqual(res.status, 400, `contribute=${JSON.stringify(contribute)}`);
    assert.strictEqual(res.body.error, MESSAGES.MONEY_ERROR);
  }
});

test('POST /api/goals validates the title and the target amount', async () => {
  const { token } = await registerUser(ctx.client);

  const noTitle = await ctx.client.post('/api/goals', { title: '   ', target_amount: 10 }, { token });
  assert.strictEqual(noTitle.status, 400);
  assert.strictEqual(noTitle.body.error, MESSAGES.GOAL_TITLE_REQUIRED);

  const badTarget = await ctx.client.post('/api/goals', { title: 'Ціль', target_amount: 0 }, { token });
  assert.strictEqual(badTarget.status, 400);
  assert.strictEqual(badTarget.body.error, MESSAGES.GOAL_TARGET_ERROR);
});
