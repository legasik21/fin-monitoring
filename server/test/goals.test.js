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

test('PATCH /api/goals/:id updates the title (trimmed) and rejects empty/too-long titles', async () => {
  const { token } = await registerUser(ctx.client);
  const created = await ctx.client.post('/api/goals', { title: 'Стара назва', target_amount: 100 }, { token });
  assert.strictEqual(created.status, 201);
  const goalId = created.body.id;

  const renamed = await ctx.client.patch(`/api/goals/${goalId}`, { title: '  Нова назва  ' }, { token });
  assert.strictEqual(renamed.status, 200);
  assert.strictEqual(renamed.body.title, 'Нова назва');

  const empty = await ctx.client.patch(`/api/goals/${goalId}`, { title: '   ' }, { token });
  assert.strictEqual(empty.status, 400);
  assert.strictEqual(empty.body.error, MESSAGES.GOAL_TITLE_REQUIRED);

  const tooLong = await ctx.client.patch(`/api/goals/${goalId}`, { title: 'а'.repeat(201) }, { token });
  assert.strictEqual(tooLong.status, 400);
  assert.strictEqual(tooLong.body.error, MESSAGES.GOAL_TITLE_LONG);
});

test('PATCH /api/goals/:id validates target_amount (<= 0 -> 400) and sets current_amount absolutely, including 0', async () => {
  const { token } = await registerUser(ctx.client);
  const created = await ctx.client.post('/api/goals', { title: 'Ціль з сумою', target_amount: 200 }, { token });
  assert.strictEqual(created.status, 201);
  const goalId = created.body.id;

  const zeroTarget = await ctx.client.patch(`/api/goals/${goalId}`, { target_amount: 0 }, { token });
  assert.strictEqual(zeroTarget.status, 400);
  assert.strictEqual(zeroTarget.body.error, MESSAGES.GOAL_TARGET_ERROR);

  const negativeTarget = await ctx.client.patch(`/api/goals/${goalId}`, { target_amount: -10 }, { token });
  assert.strictEqual(negativeTarget.status, 400);
  assert.strictEqual(negativeTarget.body.error, MESSAGES.GOAL_TARGET_ERROR);

  const contributed = await ctx.client.patch(`/api/goals/${goalId}`, { contribute: 150 }, { token });
  assert.strictEqual(contributed.status, 200);
  assert.strictEqual(contributed.body.current_amount, 150);

  // current_amount sets the absolute value (not an addition), 0 included.
  const reset = await ctx.client.patch(`/api/goals/${goalId}`, { current_amount: 0 }, { token });
  assert.strictEqual(reset.status, 200);
  assert.strictEqual(reset.body.current_amount, 0);
  assert.strictEqual(reset.body.achieved, false);
});

test('achieved is re-evaluated when target_amount drops below the existing current_amount', async () => {
  const { token } = await registerUser(ctx.client);
  const created = await ctx.client.post('/api/goals', { title: 'Ціль що досягається', target_amount: 500 }, { token });
  assert.strictEqual(created.status, 201);
  const goalId = created.body.id;

  const funded = await ctx.client.patch(`/api/goals/${goalId}`, { current_amount: 300 }, { token });
  assert.strictEqual(funded.status, 200);
  assert.strictEqual(funded.body.achieved, false);

  const loweredTarget = await ctx.client.patch(`/api/goals/${goalId}`, { target_amount: 200 }, { token });
  assert.strictEqual(loweredTarget.status, 200);
  assert.strictEqual(loweredTarget.body.current_amount, 300);
  assert.strictEqual(loweredTarget.body.achieved, true);
});

test('a contribution that would push current_amount above the max amount -> 400, not 500, and leaves the goal unchanged', async () => {
  const { token } = await registerUser(ctx.client);
  const created = await ctx.client.post(
    '/api/goals',
    { title: 'Величезна ціль', target_amount: 999999999999.99 },
    { token }
  );
  assert.strictEqual(created.status, 201);
  const goalId = created.body.id;

  const setNearMax = await ctx.client.patch(`/api/goals/${goalId}`, { current_amount: 999999999999.98 }, { token });
  assert.strictEqual(setNearMax.status, 200);
  assert.strictEqual(setNearMax.body.current_amount, 999999999999.98);

  const overflow = await ctx.client.patch(`/api/goals/${goalId}`, { contribute: 0.5 }, { token });
  assert.strictEqual(overflow.status, 400);
  assert.strictEqual(overflow.body.error, MESSAGES.MONEY_ERROR);

  const unchanged = await ctx.client.get(`/api/goals/${goalId}`, { token });
  assert.strictEqual(unchanged.status, 200);
  assert.strictEqual(unchanged.body.current_amount, 999999999999.98);
});
