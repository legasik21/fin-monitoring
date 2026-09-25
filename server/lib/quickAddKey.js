import crypto from 'node:crypto';

// Recognisable prefix so a leaked key is easy to identify (e.g. by secret scanners).
const KEY_PREFIX = 'fmq_';

/**
 * sha256 hex of a personal quick-add key — the only form stored in
 * users.quick_add_key_hash. Keys carry 256 random bits, so an unsalted fast hash
 * is sufficient: there is nothing to brute-force, and it allows lookup by hash.
 */
export function hashQuickAddKey(key) {
  return crypto.createHash('sha256').update(String(key), 'utf8').digest('hex');
}

/** A fresh random key (shown to the user exactly once) plus its stored hash. */
export function generateQuickAddKey() {
  const key = KEY_PREFIX + crypto.randomBytes(32).toString('base64url');
  return { key, hash: hashQuickAddKey(key) };
}
