import jwt from 'jsonwebtoken';
import { eq } from 'drizzle-orm';
import db from '../db.js';
import { users } from '../schema.js';

const MAX_INT4 = 2147483647;
const BEARER_RE = /^Bearer +(\S+)$/i;
const SUB_RE = /^[1-9]\d{0,9}$/;

/** JWT `sub` → user id (int4), or null. Old single-user tokens have no `sub`. */
function parseSubject(sub) {
  let id = null;
  if (typeof sub === 'number') id = sub;
  else if (typeof sub === 'string' && SUB_RE.test(sub)) id = Number(sub);
  return Number.isInteger(id) && id >= 1 && id <= MAX_INT4 ? id : null;
}

/**
 * Guards a route: requires a valid `Authorization: Bearer <token>` header and
 * puts the authenticated user's id on `req.userId` (number).
 * 401 `Не авторизовано` when the header is missing/malformed, `Недійсний токен`
 * when the JWT is bad or expired, or its user no longer exists.
 */
export async function requireAuth(req, res, next) {
  const match = BEARER_RE.exec(req.headers.authorization || '');
  if (!match) {
    return res.status(401).json({ error: 'Не авторизовано' });
  }

  let payload;
  try {
    // Pin the algorithm so a token can never pick its own (e.g. "none").
    payload = jwt.verify(match[1], process.env.JWT_SECRET, { algorithms: ['HS256'] });
  } catch {
    return res.status(401).json({ error: 'Недійсний токен' });
  }

  const userId = parseSubject(payload?.sub);
  if (userId === null || typeof payload.iat !== 'number') {
    return res.status(401).json({ error: 'Недійсний токен' });
  }

  const [user] = await db
    .select({ id: users.id, created_at: users.created_at })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  // A token issued before its user row was created belongs to someone else: after
  // a DB reset serial ids restart, so an old token's `sub` can name a new user.
  // Both sides are whole seconds (jsonwebtoken floors iat).
  if (!user || payload.iat < Math.floor(user.created_at.getTime() / 1000)) {
    return res.status(401).json({ error: 'Недійсний токен' });
  }

  req.userId = user.id;
  next();
}
