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
