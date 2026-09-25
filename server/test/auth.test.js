// server/routes/auth.js + server/middleware/auth.js, tested strictly against
// docs/API.md (never against the builders' code): register/login/me, the
// duplicate-email and validation 400/409s, and every requireAuth 401 path
// including forged tokens (old single-user shape, unknown user id, garbage).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  startApp,
  stopApp,
  closePool,
  registerUser,
  uniqueEmail,
  signRaw,
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

test('register -> login -> me, and login tolerates a differently-cased/padded email', async () => {
  const email = uniqueEmail('flow');
  const password = 'correct-horse-1';

  const reg = await ctx.client.post('/api/auth/register', { email, password });
  assert.strictEqual(reg.status, 201);
  assert.strictEqual(typeof reg.body.token, 'string');
  assert.strictEqual(typeof reg.body.user.id, 'number');
  assert.strictEqual(reg.body.user.email, email.toLowerCase());
  assert.strictEqual(reg.body.user.has_quick_add_key, false);
  assert.strictEqual(typeof reg.body.user.created_at, 'string');
  assert.strictEqual(reg.body.user.password_hash, undefined);

  const login = await ctx.client.post('/api/auth/login', {
    email: `  ${email.toUpperCase()}  `,
    password,
  });
  assert.strictEqual(login.status, 200);
  assert.strictEqual(typeof login.body.token, 'string');
  assert.strictEqual(login.body.user.email, email.toLowerCase());

  const me = await ctx.client.get('/api/auth/me', { token: login.body.token });
  assert.strictEqual(me.status, 200);
  assert.strictEqual(me.body.id, reg.body.user.id);
  assert.strictEqual(me.body.email, email.toLowerCase());
  assert.strictEqual(me.body.has_quick_add_key, false);
});

test('duplicate email is rejected, including a differently-cased/padded variant', async () => {
  const email = uniqueEmail('dup');
  const first = await ctx.client.post('/api/auth/register', { email, password: 'password123' });
  assert.strictEqual(first.status, 201);

  const exact = await ctx.client.post('/api/auth/register', { email, password: 'password123' });
  assert.strictEqual(exact.status, 409);
  assert.strictEqual(exact.body.error, MESSAGES.EMAIL_TAKEN);

  const variant = await ctx.client.post('/api/auth/register', {
    email: `  ${email.toUpperCase()}  `,
    password: 'password123',
  });
  assert.strictEqual(variant.status, 409);
  assert.strictEqual(variant.body.error, MESSAGES.EMAIL_TAKEN);
});

test('invalid email format -> 400', async () => {
  const res = await ctx.client.post('/api/auth/register', {
    email: 'not-an-email',
    password: 'password123',
  });
  assert.strictEqual(res.status, 400);
  assert.strictEqual(res.body.error, MESSAGES.INVALID_EMAIL);
});

test('password shorter than 8 chars -> 400', async () => {
  const res = await ctx.client.post('/api/auth/register', {
    email: uniqueEmail('short'),
    password: '1234567',
  });
  assert.strictEqual(res.status, 400);
  assert.strictEqual(res.body.error, MESSAGES.PASSWORD_SHORT);
});

test('password longer than 128 chars -> 400', async () => {
  const res = await ctx.client.post('/api/auth/register', {
    email: uniqueEmail('long'),
    password: 'a'.repeat(129),
  });
  assert.strictEqual(res.status, 400);
  assert.strictEqual(res.body.error, MESSAGES.PASSWORD_LONG);
});

test('login: wrong password and unknown email both answer the identical 401', async () => {
  const { email } = await registerUser(ctx.client);

  const wrongPw = await ctx.client.post('/api/auth/login', { email, password: 'totally-wrong' });
  assert.strictEqual(wrongPw.status, 401);
  assert.strictEqual(wrongPw.body.error, MESSAGES.LOGIN_WRONG);

  const unknown = await ctx.client.post('/api/auth/login', {
    email: uniqueEmail('ghost'),
    password: 'whatever123',
  });
  assert.strictEqual(unknown.status, 401);
  assert.strictEqual(unknown.body.error, MESSAGES.LOGIN_WRONG);
});

test('login with a missing/non-string field -> 400', async () => {
  const res = await ctx.client.post('/api/auth/login', { email: 'a@b.com' });
  assert.strictEqual(res.status, 400);
  assert.strictEqual(res.body.error, MESSAGES.LOGIN_MISSING);
});

test('requireAuth: missing Authorization header -> 401 Не авторизовано', async () => {
  const res = await ctx.client.get('/api/auth/me');
  assert.strictEqual(res.status, 401);
  assert.strictEqual(res.body.error, MESSAGES.UNAUTHORIZED);
});

test('requireAuth: malformed Authorization header -> 401 Не авторизовано', async () => {
  const res = await ctx.client.get('/api/auth/me', { headers: { Authorization: 'Token abc' } });
  assert.strictEqual(res.status, 401);
  assert.strictEqual(res.body.error, MESSAGES.UNAUTHORIZED);
});

test('requireAuth: garbage token -> 401 Недійсний токен', async () => {
  const res = await ctx.client.get('/api/auth/me', { token: 'garbage.not-a.jwt' });
  assert.strictEqual(res.status, 401);
  assert.strictEqual(res.body.error, MESSAGES.INVALID_TOKEN);
});

test('requireAuth: old single-user token ({ app: "fin_monitoring" }) -> 401 Недійсний токен', async () => {
  // The pre-multi-user app signed tokens with no `sub` at all — only an app tag.
  const oldToken = signRaw({ app: 'fin_monitoring' }, { expiresIn: '30d' });
  const res = await ctx.client.get('/api/auth/me', { token: oldToken });
  assert.strictEqual(res.status, 401);
  assert.strictEqual(res.body.error, MESSAGES.INVALID_TOKEN);
});

test('requireAuth: a well-formed token for a non-existent user id -> 401 Недійсний токен', async () => {
  const ghostToken = signRaw({ sub: '2000000000' }, { expiresIn: '30d' });
  const res = await ctx.client.get('/api/auth/me', { token: ghostToken });
  assert.strictEqual(res.status, 401);
  assert.strictEqual(res.body.error, MESSAGES.INVALID_TOKEN);
});

test('malformed JSON request body -> 400 Невірний формат запиту', async () => {
  const res = await ctx.client.request('POST', '/api/auth/login', { rawBody: '{not json' });
  assert.strictEqual(res.status, 400);
  assert.strictEqual(res.body.error, MESSAGES.BAD_REQUEST_BODY);
});
