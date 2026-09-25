import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '.env') });

// Fail fast on missing required configuration (mirrors db.js's DATABASE_URL check)
// so a misconfigured deploy crashes loudly instead of silently 401-ing every request.
for (const key of ['DATABASE_URL', 'JWT_SECRET']) {
  if (!process.env[key]) {
    console.error(`[config] Missing required env var: ${key}`);
    process.exit(1);
  }
}

// app.js and the routes import db.js, which reads DATABASE_URL — load env first,
// then apply any pending Drizzle migrations before the API starts serving requests.
const { runMigrations } = await import('./migrate.js');
await runMigrations();

const { createApp } = await import('./app.js');

const PORT = process.env.PORT || 3001;

// Express 5 hands listen errors (e.g. EADDRINUSE) to this callback instead of
// crashing, so exit explicitly rather than idle with no server behind the port.
createApp().listen(PORT, (err) => {
  if (err) {
    console.error(`[server] cannot listen on port ${PORT}: ${err.message}`);
    process.exit(1);
  }
  console.log(`[server] API listening on http://localhost:${PORT}`);
});
