import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import dotenv from 'dotenv';
import express from 'express';
import cors from 'cors';
import authRouter from './routes/auth.js';
import { requireAuth } from './middleware/auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '.env') });

// Fail fast on missing required configuration (mirrors db.js's DATABASE_URL check)
// so a misconfigured deploy crashes loudly instead of silently 401-ing every request.
for (const key of ['DATABASE_URL', 'APP_PASSWORD', 'JWT_SECRET', 'QUICK_ADD_TOKEN']) {
  if (!process.env[key]) {
    console.error(`[config] Missing required env var: ${key}`);
    process.exit(1);
  }
}

// Routes import db.js, which reads DATABASE_URL — load env first, then apply
// any pending Drizzle migrations before the API starts serving requests.
const { runMigrations } = await import('./migrate.js');
await runMigrations();

const { default: daysRouter } = await import('./routes/days.js');
const { default: statsRouter } = await import('./routes/stats.js');
const { default: goalsRouter } = await import('./routes/goals.js');
const { default: quickAddRouter } = await import('./routes/quick-add.js');

const PORT = process.env.PORT || 3001;

const app = express();
app.use(cors({ origin: ['http://localhost:5173', 'http://127.0.0.1:5173'] }));
app.use(express.json());

app.get('/api/health', (_req, res) => res.json({ ok: true }));

// Public: login, and quick-add (guarded by its own X-API-Key for Apple Shortcuts).
app.use('/api/auth', authRouter);
app.use('/api/quick-add', quickAddRouter);
// Everything else requires a valid JWT.
app.use('/api/days', requireAuth, daysRouter);
app.use('/api/stats', requireAuth, statsRouter);
app.use('/api/goals', requireAuth, goalsRouter);

const clientDist = path.resolve(__dirname, '../client/dist');
const clientIndex = path.join(clientDist, 'index.html');

if (fs.existsSync(clientIndex)) {
  app.use(express.static(clientDist));
  app.use((req, res, next) => {
    if ((req.method === 'GET' || req.method === 'HEAD') && req.accepts('html')) {
      return res.sendFile(clientIndex);
    }
    next();
  });
}

// Centralised error handler.
app.use((err, _req, res, _next) => {
  // Avoid leaking stack traces / connection internals into production logs.
  console.error('[error]', process.env.NODE_ENV === 'production' ? err.message : err);
  res.status(500).json({ error: 'Внутрішня помилка сервера' });
});

app.listen(PORT, () => {
  console.log(`[server] API listening on http://localhost:${PORT}`);
});
