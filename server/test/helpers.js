// Shared test scaffolding: an in-process copy of the app per test FILE (started
// once in a top-level `before()`), a tiny fetch-based HTTP client, and a couple
// of date/token helpers so every test file computes "today" and forges JWTs the
// same way the server does. Deliberately dependency-free (node:test / fetch /
// jsonwebtoken only — jsonwebtoken is already a server dependency).
//
// Tests never truncate tables or assert on global row counts: `node --test`
// runs test FILES in parallel processes against ONE throwaway Postgres
// (scripts/test.sh), so every helper that creates data uses a fresh random
// user rather than shared fixtures.

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';

/** Start the app on an ephemeral port; returns { server, baseUrl, client }. */
export async function startApp() {
  const { createApp } = await import('../app.js');
  const app = createApp();
  const server = app.listen(0);
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;
  return { server, baseUrl, client: makeClient(baseUrl) };
}

/** Close the HTTP server (call from an `after()` hook). */
export function stopApp(server) {
  return new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}

/**
 * End the shared pg Pool this test file's `db.js` opened, so the Node process
 * (and its parent `node --test` worker) can exit instead of hanging on an open
 * TCP handle. Must run once per file, after `stopApp`.
 */
export async function closePool() {
  const { pool } = await import('../db.js');
  await pool.end();
}

/**
 * Minimal fetch-based JSON client. `token` adds a Bearer Authorization header,
 * `apiKey` adds X-API-Key (quick-add). `rawBody` sends a literal string instead
 * of JSON.stringify(body), so tests can post deliberately malformed JSON.
 */
export function makeClient(baseUrl) {
  async function request(method, path, { token, apiKey, body, rawBody, headers } = {}) {
    const reqHeaders = { ...headers };
    if (token) reqHeaders.Authorization = `Bearer ${token}`;
    if (apiKey) reqHeaders['X-API-Key'] = apiKey;

    let payload;
    if (rawBody !== undefined) {
      payload = rawBody;
      reqHeaders['Content-Type'] = 'application/json';
    } else if (body !== undefined) {
      payload = JSON.stringify(body);
      reqHeaders['Content-Type'] = 'application/json';
    }

    const res = await fetch(`${baseUrl}${path}`, { method, headers: reqHeaders, body: payload });
    const text = await res.text();
    let json = null;
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        json = undefined; // non-JSON response body (should not happen for /api/*)
      }
    }
    return { status: res.status, body: json, raw: text };
  }

  return {
    get: (path, opts) => request('GET', path, opts),
    post: (path, body, opts) => request('POST', path, { ...opts, body }),
    patch: (path, body, opts) => request('PATCH', path, { ...opts, body }),
    put: (path, body, opts) => request('PUT', path, { ...opts, body }),
    del: (path, opts) => request('DELETE', path, opts),
    request,
  };
}

/** A fresh, collision-free email for register() calls. */
export function uniqueEmail(prefix = 'user') {
  return `${prefix}-${crypto.randomUUID()}@example.com`;
}

/**
 * Register a brand-new user (unique email unless overridden) and return its
 * credentials + the register response. Fails the test loudly (via assert) if
 * registration itself did not succeed, so a setup bug never masquerades as a
 * failure in the actual test body.
 */
export async function registerUser(client, overrides = {}) {
  const email = overrides.email ?? uniqueEmail();
  const password = overrides.password ?? 'password123';
  const body = { email, password };
  if (overrides.categories !== undefined) body.categories = overrides.categories;

  const res = await client.post('/api/auth/register', body);
  assert.strictEqual(res.status, 201, `registerUser setup failed: ${res.status} ${JSON.stringify(res.body)}`);
  return { email, password, token: res.body.token, user: res.body.user };
}

/** Generate a quick-add key for an already-authenticated user; returns the plaintext key. */
export async function issueQuickAddKey(client, token) {
  const res = await client.post('/api/auth/quick-add-key', undefined, { token });
  assert.strictEqual(res.status, 201, `issueQuickAddKey setup failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.key;
}

/**
 * Sign an arbitrary JWT with the suite's JWT_SECRET (set by scripts/test.sh),
 * so tests can forge tokens requireAuth must reject: old single-user tokens,
 * tokens for ids that don't exist, tokens with no `sub`, etc.
 */
export function signRaw(payload, opts = {}) {
  return jwt.sign(payload, process.env.JWT_SECRET, { algorithm: 'HS256', ...opts });
}

/** Local calendar date as YYYY-MM-DD — mirrors lib/dates.js exactly. */
export function toDateStr(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Local "today", computed the same way lib/dates.js's todayStr() does. */
export function todayStr() {
  return toDateStr(new Date());
}

/** Local date `n` days from now (negative = past) as YYYY-MM-DD. */
export function addDaysStr(base, n) {
  const d = new Date(base);
  d.setDate(d.getDate() + n);
  return toDateStr(d);
}

export function yesterdayStr() {
  return addDaysStr(new Date(), -1);
}

// Exact Ukrainian error strings quoted verbatim in docs/API.md, centralised so
// every test file compares against the same literal instead of re-typing it
// (and risking a typo that would silently weaken the assertion).
export const MESSAGES = {
  UNAUTHORIZED: 'Не авторизовано',
  INVALID_TOKEN: 'Недійсний токен',
  BAD_REQUEST_BODY: 'Невірний формат запиту',
  NOT_FOUND_ROUTE: 'Не знайдено',
  INVALID_ID: 'Невірний ідентифікатор',
  INVALID_DATE: 'Невірний формат дати (очікується YYYY-MM-DD)',
  MONEY_ERROR: 'Сума має бути додатнім числом',
  NOTE_ERROR: 'Нотатка — до 200 символів',
  NO_CHANGES: 'Немає змін',
  INVALID_EMAIL: 'Невірний формат email',
  PASSWORD_SHORT: 'Пароль має містити щонайменше 8 символів',
  PASSWORD_LONG: 'Пароль занадто довгий',
  EMAIL_TAKEN: 'Користувач з таким email вже існує',
  LOGIN_MISSING: 'Вкажіть email і пароль',
  LOGIN_WRONG: 'Невірний email або пароль',
  CATEGORY_NOT_FOUND: 'Категорію не знайдено',
  CATEGORY_KIND_ERROR: 'Невірний тип категорії',
  CATEGORY_DUPLICATE: 'Категорія з такою назвою вже існує',
  CATEGORY_ARCHIVED_IMMUTABLE: 'Архівну категорію не можна змінити',
  CATEGORY_LAST_ACTIVE: 'Не можна видалити останню активну категорію цього типу',
  CATEGORY_ORDER_ERROR: 'Невірний порядок категорій',
  TRANSACTION_NOT_FOUND: 'Запис не знайдено',
  CATEGORY_ARCHIVED_FOR_TX: 'Категорію архівовано',
  TODAY_EMPTY: 'Сьогодні ще немає записів',
  GOAL_NOT_FOUND: 'Ціль не знайдено',
  GOAL_TITLE_REQUIRED: 'Вкажіть назву цілі',
  GOAL_TITLE_LONG: 'Назва занадто довга',
  GOAL_TARGET_ERROR: 'Сума цілі має бути більшою за 0',
  QUICK_ADD_KEY_INVALID: 'Невірний ключ API',
  QUICK_ADD_UNKNOWN_CATEGORY: 'Невідома категорія',
  QUICK_ADD_AMBIGUOUS: 'Неоднозначна категорія: вкажіть kind (income або expense)',
  QUICK_ADD_NONE_TODAY: 'Немає швидких записів за сьогодні',
};
