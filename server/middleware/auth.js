import jwt from 'jsonwebtoken';

/**
 * Guards a route: requires a valid `Authorization: Bearer <token>` header.
 * Responds 401 when the header is missing or the JWT fails verification.
 */
export function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ error: 'Не авторизовано' });
  }

  try {
    jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: 'Недійсний токен' });
  }
}
