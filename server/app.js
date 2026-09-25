import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import express from 'express';
import cors from 'cors';
import { requireAuth } from './middleware/auth.js';
import authRouter from './routes/auth.js';
import quickAddRouter from './routes/quick-add.js';
import categoriesRouter from './routes/categories.js';
import transactionsRouter from './routes/transactions.js';
import daysRouter from './routes/days.js';
import statsRouter from './routes/stats.js';
import goalsRouter from './routes/goals.js';

// Importing this module pulls in db.js, which reads DATABASE_URL at import time:
// set DATABASE_URL and JWT_SECRET before importing (index.js loads .env first).

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientDist = path.resolve(__dirname, '../client/dist');
const clientIndex = path.join(clientDist, 'index.html');

const isApiPath = (p) => /^\/api(\/|$)/i.test(p);

/** The node-pg error behind a (possibly drizzle-wrapped) error, or null. */
function pgErrorOf(err) {
  for (let e = err, depth = 0; e && depth < 5; e = e.cause, depth++) {
    if (typeof e.code === 'string' && /^[0-9A-Z]{5}$/.test(e.code)) return e;
  }
  return null;
}

// Centralised error handler: client mistakes keep their 4xx, anything else is a
// generic 500 so SQL, stack traces or connection details never reach the client.
function errorHandler(err, _req, res, next) {
  if (res.headersSent) return next(err);

  // body-parser: malformed JSON (400), body too large (413), bad charset (415)…
  const status = err?.status ?? err?.statusCode;
  if (err?.type === 'entity.parse.failed' || (Number.isInteger(status) && status >= 400 && status < 500)) {
    return res
      .status(err?.type === 'entity.parse.failed' ? 400 : status)
      .json({ error: 'Невірний формат запиту' });
  }

  // Text containing NUL / invalid UTF-8 is rejected by Postgres itself; that is
  // a bad request, not a server fault, whichever route's field carried it.
  const pgErr = pgErrorOf(err);
  if (pgErr?.code === '22021' || pgErr?.code === '22P05') {
    return res.status(400).json({ error: 'Невірний формат запиту' });
  }

  // Avoid leaking stack traces / connection internals into production logs.
  // Drizzle wraps driver errors in "Failed query: … params: …", and the params
  // can hold emails or password hashes, so log the driver's own message instead.
  const logged =
    process.env.NODE_ENV === 'production' ? (pgErr?.message ?? err?.message ?? String(err)) : err;
  console.error('[error]', logged);
  res.status(500).json({ error: 'Внутрішня помилка сервера' });
}

/** Build the Express app (routes per docs/API.md). Listening is up to the caller. */
export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(cors({ origin: ['http://localhost:5173', 'http://127.0.0.1:5173'] }));
  app.use(express.json());

  app.get('/api/health', (_req, res) => res.json({ ok: true }));

  // Public: register/login (the router guards /me and /quick-add-key itself), and
  // quick-add, which authenticates its own per-user X-API-Key for Apple Shortcuts.
  app.use('/api/auth', authRouter);
  app.use('/api/quick-add', quickAddRouter);
  // Everything else requires a valid JWT; requireAuth sets req.userId.
  app.use('/api/categories', requireAuth, categoriesRouter);
  app.use('/api/transactions', requireAuth, transactionsRouter);
  app.use('/api/days', requireAuth, daysRouter);
  app.use('/api/stats', requireAuth, statsRouter);
  app.use('/api/goals', requireAuth, goalsRouter);

  // Unknown API routes answer JSON 404 — never the SPA's index.html, which a
  // client would otherwise try to parse as data.
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Не знайдено' }));

  // Serve the built client when present (production image); in dev Vite serves it.
  if (fs.existsSync(clientIndex)) {
    app.use(express.static(clientDist));
    // SPA fallback: client-side routes (/day/2026-09-25, /settings…) get index.html.
    app.use((req, res, next) => {
      if (
        (req.method === 'GET' || req.method === 'HEAD') &&
        !isApiPath(req.path) &&
        req.accepts('html')
      ) {
        return res.sendFile(clientIndex);
      }
      next();
    });
  }

  app.use(errorHandler);
  return app;
}
