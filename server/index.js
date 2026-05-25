import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import express from 'express';
import cors from 'cors';
import authRouter from './routes/auth.js';
import { requireAuth } from './middleware/auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '.env') });

// Routes import db.js, which reads DB_PATH — load env first.
const { default: daysRouter } = await import('./routes/days.js');
const { default: statsRouter } = await import('./routes/stats.js');

const PORT = process.env.PORT || 3001;

const app = express();
app.use(cors({ origin: ['http://localhost:5173', 'http://127.0.0.1:5173'] }));
app.use(express.json());

app.get('/api/health', (_req, res) => res.json({ ok: true }));

// Public: login. Everything else requires a valid JWT.
app.use('/api/auth', authRouter);
app.use('/api/days', requireAuth, daysRouter);
app.use('/api/stats', requireAuth, statsRouter);

// Centralised error handler.
app.use((err, _req, res, _next) => {
  console.error('[error]', err);
  res.status(500).json({ error: 'Внутрішня помилка сервера' });
});

app.listen(PORT, () => {
  console.log(`[server] API listening on http://localhost:${PORT}`);
});
