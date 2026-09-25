import crypto from 'node:crypto';
import { promisify } from 'node:util';

// Password hashing with Node's built-in scrypt (memory-hard, no extra dependency).
// Stored as a self-describing string so the cost can be raised later without
// breaking existing hashes:  scrypt$N$r$p$<salt base64>$<hash base64>

const scrypt = promisify(crypto.scrypt);

const N = 32768; // 2^15 — ~32 MiB and roughly 50–100 ms per hash on a small VPS
const R = 8;
const P = 1;
const SALT_BYTES = 16;
const KEY_BYTES = 64;
// OpenSSL needs 128·r·(N+2) + 128·r·p bytes, just over 32 MiB for the params
// above, which is also Node's default maxmem — hence the explicit, larger budget.
const MAXMEM = 64 * 1024 * 1024;

const PREFIX = 'scrypt';
const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;
const UINT_RE = /^[1-9]\d{0,9}$/;

function derive(password, salt, n, r, p, keylen) {
  return scrypt(String(password).normalize('NFC'), salt, keylen, { N: n, r, p, maxmem: MAXMEM });
}

/** Hash a plaintext password → 'scrypt$N$r$p$salt$hash'. */
export async function hashPassword(password) {
  const salt = crypto.randomBytes(SALT_BYTES);
  const hash = await derive(password, salt, N, R, P, KEY_BYTES);
  return [PREFIX, N, R, P, salt.toString('base64'), hash.toString('base64')].join('$');
}

/** Strict base64 → Buffer (null when not canonical), so junk never reaches scrypt. */
function decodeBase64(s) {
  if (!BASE64_RE.test(s)) return null;
  const buf = Buffer.from(s, 'base64');
  return buf.toString('base64') === s ? buf : null;
}

/**
 * Parse a stored hash. Returns null for anything malformed or with parameters we
 * would refuse to run (not a power of two, too cheap to be ours, or needing more
 * memory than MAXMEM) — a corrupted row must fail closed, never throw or hang.
 */
function parseStored(stored) {
  if (typeof stored !== 'string') return null;
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== PREFIX) return null;
  const [, nStr, rStr, pStr, saltStr, hashStr] = parts;
  if (!UINT_RE.test(nStr) || !UINT_RE.test(rStr) || !UINT_RE.test(pStr)) return null;
  const n = Number(nStr);
  const r = Number(rStr);
  const p = Number(pStr);
  if (n < 1024 || (n & (n - 1)) !== 0 || r > 32 || p > 16) return null;
  if (128 * r * (n + 2) + 128 * r * p > MAXMEM) return null;
  const salt = decodeBase64(saltStr);
  const hash = decodeBase64(hashStr);
  if (!salt || !hash || salt.length < 8 || hash.length < 16 || hash.length > 128) return null;
  return { n, r, p, salt, hash };
}

/** Constant-time check of a plaintext password against a stored hash. Never throws. */
export async function verifyPassword(password, stored) {
  if (typeof password !== 'string') return false;
  const parsed = parseStored(stored);
  if (!parsed) return false;
  const { n, r, p, salt, hash } = parsed;
  let actual;
  try {
    actual = await derive(password, salt, n, r, p, hash.length);
  } catch {
    return false;
  }
  return actual.length === hash.length && crypto.timingSafeEqual(actual, hash);
}

// Login verifies unknown emails against this hash, so "no such user" costs the
// same single scrypt run as "wrong password" and response timing does not reveal
// which emails are registered. Random, never persisted: it can match nothing.
export const DUMMY_PASSWORD_HASH = await hashPassword(crypto.randomBytes(32).toString('base64url'));
