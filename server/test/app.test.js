// App-level plumbing (server/app.js): health check, the catch-all 404 for
// unmatched /api/* routes, and the malformed-JSON-body 400 that must apply
// uniformly regardless of which router eventually would have handled the path.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, stopApp, closePool, MESSAGES } from './helpers.js';

let ctx;

before(async () => {
  ctx = await startApp();
});

after(async () => {
  await stopApp(ctx.server);
  await closePool();
});

test('GET /api/health -> 200 { ok: true }', async () => {
  const res = await ctx.client.get('/api/health');
  assert.strictEqual(res.status, 200);
  assert.deepStrictEqual(res.body, { ok: true });
});

test('unknown GET /api/xyz -> 404 JSON (never the SPA HTML)', async () => {
  const res = await ctx.client.get('/api/xyz');
  assert.strictEqual(res.status, 404);
  assert.strictEqual(res.body.error, MESSAGES.NOT_FOUND_ROUTE);
});

test('unknown POST /api/xyz -> 404 JSON for any method', async () => {
  const res = await ctx.client.post('/api/xyz', { a: 1 });
  assert.strictEqual(res.status, 404);
  assert.strictEqual(res.body.error, MESSAGES.NOT_FOUND_ROUTE);
});

test('malformed JSON body -> 400 Невірний формат запиту', async () => {
  const res = await ctx.client.request('POST', '/api/auth/register', {
    rawBody: '{"email": "a@b.com", "password":',
  });
  assert.strictEqual(res.status, 400);
  assert.strictEqual(res.body.error, MESSAGES.BAD_REQUEST_BODY);
});

test('a JSON body over 100 kB to POST /api/auth/register -> 413 Невірний формат запиту', async () => {
  const res = await ctx.client.post('/api/auth/register', {
    email: 'oversized@example.com',
    password: 'password123',
    padding: 'x'.repeat(150_000), // well past express.json()'s default 100kb limit
  });
  assert.strictEqual(res.status, 413);
  assert.strictEqual(res.body.error, MESSAGES.BAD_REQUEST_BODY);
});

test('unmatched /api routes -> 404 JSON for non-GET methods too, including under a mounted sub-router', async () => {
  const del = await ctx.client.del('/api/nope');
  assert.strictEqual(del.status, 404);
  assert.strictEqual(del.body.error, MESSAGES.NOT_FOUND_ROUTE);

  const authNope = await ctx.client.post('/api/auth/nope', {});
  assert.strictEqual(authNope.status, 404);
  assert.strictEqual(authNope.body.error, MESSAGES.NOT_FOUND_ROUTE);
});
