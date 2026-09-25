import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { eq } from 'drizzle-orm';
import db from '../db.js';
import { users } from '../schema.js';
import { requireAuth } from '../middleware/auth.js';
import { hashPassword, verifyPassword, DUMMY_PASSWORD_HASH } from '../lib/password.js';
import { resolveRegistrationCategories, insertInitialCategories } from '../lib/categories.js';
import { generateQuickAddKey } from '../lib/quickAddKey.js';

const router = Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Control characters (NUL above all) cannot be stored in a Postgres text column;
// rejecting them here keeps such input a 400 instead of a driver error.
const CONTROL_RE = /[\u0000-\u001f\u007f]/;
const EMAIL_MAX = 254;
const PASSWORD_MIN = 8;
const PASSWORD_MAX = 128;

// Only these columns ever leave the server — never password_hash or the key hash.
const USER_COLUMNS = {
  id: users.id,
  email: users.email,
  created_at: users.created_at,
  quick_add_key_hash: users.quick_add_key_hash,
};

const codePoints = (s) => [...s].length;

/** Same normalisation for register and login, matching the DB check constraint. */
const normalizeEmail = (raw) => raw.trim().toLowerCase();

const storableEmail = (email) => !CONTROL_RE.test(email) && codePoints(email) <= EMAIL_MAX;

/** Plain object body or {} — express.json() also accepts arrays, and no body is undefined. */
const bodyOf = (req) =>
  req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};

function serializeUser(u) {
  return {
    id: u.id,
    email: u.email,
    created_at: u.created_at,
    has_quick_add_key: u.quick_add_key_hash != null,
  };
}

/**
 * 30-day HS256 JWT for a user. iat is never earlier than the user's created_at
 * second, so requireAuth's "token older than its user" check can not reject a
 * fresh token even if the DB clock runs slightly ahead of this process's clock.
 */
function signToken(user) {
  const iat = Math.max(
    Math.floor(Date.now() / 1000),
    Math.floor(user.created_at.getTime() / 1000)
  );
  return jwt.sign({ sub: String(user.id), iat }, process.env.JWT_SECRET, {
    algorithm: 'HS256',
    expiresIn: '30d',
  });
}

/** The node-pg error behind a (possibly drizzle-wrapped) error, or null. */
function pgErrorOf(err) {
  for (let e = err, depth = 0; e && depth < 5; e = e.cause, depth++) {
    if (typeof e.code === 'string' && /^[0-9A-Z]{5}$/.test(e.code)) return e;
  }
  return null;
}

async function findUserById(id) {
  const [user] = await db.select(USER_COLUMNS).from(users).where(eq(users.id, id)).limit(1);
  return user || null;
}

// POST /api/auth/register — open registration: creates the account together with
// its initial categories (defaults or the user's own) and returns a JWT.
router.post('/register', async (req, res) => {
  const body = bodyOf(req);

  if (typeof body.email !== 'string') {
    return res.status(400).json({ error: 'Невірний формат email' });
  }
  const email = normalizeEmail(body.email);
  if (!storableEmail(email) || !EMAIL_RE.test(email)) {
    return res.status(400).json({ error: 'Невірний формат email' });
  }

  const { password } = body;
  if (typeof password !== 'string' || codePoints(password) < PASSWORD_MIN) {
    return res.status(400).json({ error: 'Пароль має містити щонайменше 8 символів' });
  }
  if (codePoints(password) > PASSWORD_MAX) {
    return res.status(400).json({ error: 'Пароль занадто довгий' });
  }

  const initial = resolveRegistrationCategories(body.categories);
  if (initial.error) return res.status(400).json({ error: initial.error });

  // Friendly early answer for the common case; the unique constraint below is
  // what actually guarantees one account per email under concurrency.
  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  if (existing) {
    return res.status(409).json({ error: 'Користувач з таким email вже існує' });
  }

  // Hash before opening the transaction so scrypt never holds a pooled connection.
  const password_hash = await hashPassword(password);

  let user;
  try {
    // One transaction: an account can never exist without its categories.
    user = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(users)
        .values({ email, password_hash })
        .returning(USER_COLUMNS);
      await insertInitialCategories(tx, created.id, initial.value);
      return created;
    });
  } catch (err) {
    const pgErr = pgErrorOf(err);
    if (pgErr?.code === '23505' && pgErr.constraint === 'users_email_unique') {
      return res.status(409).json({ error: 'Користувач з таким email вже існує' });
    }
    // JS and Postgres case-folding can disagree on rare letters, so two names the
    // helper saw as different may still collide in the lower(name) unique index.
    if (pgErr?.code === '23505' && pgErr.constraint === 'categories_active_name_unique') {
      return res.status(400).json({ error: 'Назви категорій мають бути унікальними' });
    }
    // Same folding caveat for the email: JS lowercased it, but Postgres's
    // lower() may still change an exotic letter and fail the normalisation check.
    if (pgErr?.code === '23514' && pgErr.constraint?.startsWith('users_email_')) {
      return res.status(400).json({ error: 'Невірний формат email' });
    }
    throw err;
  }

  res.status(201).json({ token: signToken(user), user: serializeUser(user) });
});

// POST /api/auth/login — email + password → 30-day JWT.
router.post('/login', async (req, res) => {
  const { email: rawEmail, password } = bodyOf(req);
  if (typeof rawEmail !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ error: 'Вкажіть email і пароль' });
  }
  const email = normalizeEmail(rawEmail);
  if (!email || !password) {
    return res.status(400).json({ error: 'Вкажіть email і пароль' });
  }

  let user = null;
  if (storableEmail(email)) {
    const [row] = await db
      .select({ ...USER_COLUMNS, password_hash: users.password_hash })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);
    user = row || null;
  }

  // Exactly one scrypt run on both paths: an unknown email is checked against
  // the dummy hash (its result is ignored), so timing does not reveal accounts.
  const ok = await verifyPassword(password, user ? user.password_hash : DUMMY_PASSWORD_HASH);
  if (!user || !ok) {
    return res.status(401).json({ error: 'Невірний email або пароль' });
  }

  res.json({ token: signToken(user), user: serializeUser(user) });
});

// GET /api/auth/me — the signed-in account.
router.get('/me', requireAuth, async (req, res) => {
  const user = await findUserById(req.userId);
  if (!user) return res.status(401).json({ error: 'Недійсний токен' });
  res.json(serializeUser(user));
});

// POST /api/auth/quick-add-key — issue (or replace) the personal Shortcuts key.
// The plaintext is returned once; only its sha256 is stored, so a lost key can
// only be regenerated, and regenerating invalidates the previous one.
router.post('/quick-add-key', requireAuth, async (req, res) => {
  const { key, hash } = generateQuickAddKey();
  const [row] = await db
    .update(users)
    .set({ quick_add_key_hash: hash })
    .where(eq(users.id, req.userId))
    .returning({ id: users.id });
  if (!row) return res.status(401).json({ error: 'Недійсний токен' });
  res.status(201).json({ key });
});

// DELETE /api/auth/quick-add-key — revoke the key (quick-add then answers 401).
router.delete('/quick-add-key', requireAuth, async (req, res) => {
  const [row] = await db
    .update(users)
    .set({ quick_add_key_hash: null })
    .where(eq(users.id, req.userId))
    .returning({ id: users.id });
  if (!row) return res.status(401).json({ error: 'Недійсний токен' });
  res.json({ ok: true });
});

export default router;
