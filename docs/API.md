# fin-monitoring API contract

Single source of truth for the server routes, the client (`client/src/api.js`) and
the integration tests (`server/test/**`). All JSON. All error bodies are
`{ "error": "<Ukrainian message>" }`. Dates are `YYYY-MM-DD` strings, months `YYYY-MM`.

## Conventions

- **Auth.** Everything except `GET /api/health`, `POST /api/auth/register`,
  `POST /api/auth/login` and the `/api/quick-add` routes requires
  `Authorization: Bearer <jwt>`. → **401** `{ error }` when: the header is missing
  or malformed (`Не авторизовано`); the JWT fails verification/expired, has no
  numeric `sub`, belongs to a user that no longer exists, or has
  `iat < Math.floor(user.created_at.getTime() / 1000)` (`Недійсний токен`).
  The `iat` check compares whole seconds on both sides (jsonwebtoken floors `iat`),
  so the token returned by register/login is always accepted; it exists so that
  after a DB reset a reused serial id never accepts an old token. Old single-user
  tokens (`{ app: 'fin_monitoring' }`, same `JWT_SECRET`) have no `sub` → 401.
- **Tenant isolation.** Every query is scoped by the authenticated `user_id`.
  An id in the URL or body that does not exist **or belongs to another user** →
  **404** with the resource's "not found" message (never 403 — do not reveal
  existence).
- **Ids.** Integers in `1..2147483647` (int4). A URL id outside that / not an
  integer → **400** `Невірний ідентифікатор`. Same for a body `category_id` that is
  missing (where required) or not such an integer.
- **"Today"** is always computed in Node with `todayStr()` from `lib/dates.js`
  (server clock, `TZ=Europe/Kyiv`) and passed to SQL as a parameter. Never use
  `current_date`, `now()::date` or `localtimestamp` in queries (the DB container
  runs in UTC).
- **Money.** Stored as `numeric(14,2)`. Requests accept a JSON number or a decimal
  string (`"12.5"`, `"12,5"`); values are rounded to 2 decimals (`parseAmount`).
  Responses always send money as JSON **numbers** with ≤ 2 decimals (`0.3`,
  `1234.5`, `10`) via `toMoney`. **All sums/arithmetic on money run in SQL**
  (`sum(amount)`, `current_amount + $1`); JS never accumulates money. Max amount
  `999999999999.99`; a result that would exceed it → the money 400 (never a 500).
- **Money validation error** (missing / not a number / ≤ 0 after rounding / too
  large) → **400** `Сума має бути додатнім числом`.
- **Date validation error** (not a real `YYYY-MM-DD`, `isValidDateStr`) → **400**
  `Невірний формат дати (очікується YYYY-MM-DD)`.
- **Text lengths** (category name ≤ 50, note ≤ 200, goal title ≤ 200) are counted
  in Unicode code points (`[...s].length`) to match Postgres `char_length()`.
- **Malformed JSON body** → **400** `Невірний формат запиту`. Unmatched `/api/*`
  route (any method) → **404** `Не знайдено` (JSON, never the SPA HTML).
  Unexpected error → **500** `Внутрішня помилка сервера` (no internals leaked).
- **is_closed** is sent as `0 | 1` (legacy client contract).

## Shared shapes

```jsonc
// User
{ "id": 1, "email": "me@example.com", "created_at": "2026-09-25T10:00:00.000Z", "has_quick_add_key": false }

// Category
{ "id": 7, "kind": "income" | "expense", "name": "Чайові", "color": "#00C896",
  "sort_order": 0, "archived": false, "archived_at": null, "created_at": "…" }

// CategoryRef (embedded in transactions / stats)
{ "id": 7, "kind": "expense", "name": "Їжа", "color": "#FF4D4D", "archived": false }

// Transaction
{ "id": 42, "date": "2026-09-25", "amount": 120.5, "note": "кава" | null,
  "source": "manual" | "quick_add", "created_at": "…", "category": CategoryRef }

// DaySummary
{ "id": 3, "date": "2026-09-25", "is_closed": 0 | 1,
  "income": 1000, "expenses": 120.5, "balance": 879.5,
  "created_at": "…", "updated_at": "…" }

// Totals (quick-add responses)
{ "income": 1000, "expenses": 120.5, "balance": 879.5 }
```

## Day rows and ledger writes (`server/lib/ledger.js`, owned by builder B)

A **day row** exists for a date once it is "recorded": created/reopened (open) by
adding a transaction to that date, or created/closed by
`PATCH /api/days/:date/close`. Deleting the last transaction of an **open** day
removes the day row (so an undone quick-add leaves no trace); a **closed** empty
day stays recorded. The DB enforces the invariant with FK
`transactions(user_id, date) → days(user_id, date)`.

**Every ledger write** (transaction POST/PATCH/DELETE, quick-add, both undo
routes, day close) runs inside ONE `db.transaction(...)` that first calls
`lockUser(tx, userId)` (from `lib/categories.js`), serialising all ledger writes
of a user. Inside it, use exactly these statements:
- add/reopen: `INSERT INTO days (user_id, date, is_closed) VALUES ($1,$2,false)
  ON CONFLICT (user_id, date) DO UPDATE SET is_closed = false, updated_at = now()`
  — **before** inserting the transaction.
- close: same upsert with `is_closed = true` (insert closed if missing).
- cleanup, right after deleting a transaction: `DELETE FROM days WHERE user_id=$1
  AND date=$2 AND is_closed = false AND NOT EXISTS (SELECT 1 FROM transactions
  WHERE user_id=$1 AND date=$2)`.
- Any UPDATE of `days` sets `updated_at = now()` explicitly (there is no trigger).

## Route mounting (`server/app.js`, owned by builder A)

Every `server/routes/*.js` has `export default` an Express `Router`.
```js
app.use(express.json());
app.get('/api/health', …);                          // { ok: true }
app.use('/api/auth', authRouter);                   // router applies requireAuth itself to /me and /quick-add-key only
app.use('/api/quick-add', quickAddRouter);          // router authenticates X-API-Key itself and sets req.userId
app.use('/api/categories', requireAuth, categoriesRouter);
app.use('/api/transactions', requireAuth, transactionsRouter);
app.use('/api/days', requireAuth, daysRouter);
app.use('/api/stats', requireAuth, statsRouter);
app.use('/api/goals', requireAuth, goalsRouter);
app.use('/api', (req, res) => res.status(404).json({ error: 'Не знайдено' }));
// then static client + SPA fallback (GET/HEAD accepting html, never /api/*), then the error handler
```
Data routers must NOT call `requireAuth` again and may assume `req.userId` is a
number. Inside routers, register fixed paths (e.g. `/last-quick-add`, `/order`,
`/today`) **before** parameterised ones (`/:id`, `/:date`).

## Health

| Method | Path | Response |
|---|---|---|
| GET | `/api/health` | `200 { "ok": true }` |

## Auth & account — `server/routes/auth.js`

### `POST /api/auth/register` (public)
Body:
```jsonc
{ "email": "Me@Example.com ", "password": "min 8 chars",
  "categories": { "income": ["ЗП – обменка", "Чайові"], "expense": ["Їжа"] } } // categories optional
```
- email: must be a string; trimmed + lowercased; ≤ 254 chars; must match
  `^[^\s@]+@[^\s@]+\.[^\s@]+$` → else **400** `Невірний формат email`.
- password: string, 8–128 chars → else **400** `Пароль має містити щонайменше 8 символів`
  (or `Пароль занадто довгий` when > 128).
- categories (optional): validated by `resolveRegistrationCategories` (per kind an
  array of names, 1–50 chars after trim, case-insensitively unique within the kind,
  ≤ 5 income / ≤ 10 expense). A missing or empty kind gets the default
  (`Дохід` / `Витрати`). Invalid → **400** with the helper's message.
- User row + initial categories are created in ONE DB transaction
  (`insertInitialCategories`).
- Postgres unique violations (23505) are mapped by constraint name:
  `users_email_unique` → **409** `Користувач з таким email вже існує` (also the
  result of a pre-check); `categories_active_name_unique` → **400**
  `Назви категорій мають бути унікальними` (JS and Postgres case-folding can differ
  for rare letters). Any other DB error → 500.
- **201** `{ "token": "<jwt>", "user": User }`

### `POST /api/auth/login` (public)
Body `{ "email", "password" }`. Non-string/missing fields → **400**
`Вкажіть email і пароль`. The email is trimmed + lowercased exactly as in register
before lookup. Unknown email or wrong password → **401** `Невірний email або пароль`;
both paths run exactly one scrypt verification (unknown email verifies against a
fixed dummy hash from `lib/password.js`) so timing does not reveal registered
emails. **200** `{ "token", "user": User }`.

### `GET /api/auth/me`
**200** `User`.

### `POST /api/auth/quick-add-key`
Generates (or regenerates, invalidating the old one) the personal quick-add key
(`generateQuickAddKey`). The plaintext key is returned **once**; only its sha256
is stored. **201** `{ "key": "fmq_…" }`.

### `DELETE /api/auth/quick-add-key`
Revokes the key (hash set to NULL). **200** `{ "ok": true }`.

JWT: HS256, `expiresIn: '30d'`, payload `{ "sub": "<user id as string>" }`, verified
with `algorithms: ['HS256']`. `requireAuth` sets `req.userId` (number).

## Categories — `server/routes/categories.js`

| Method | Path | Body | Success | Errors |
|---|---|---|---|---|
| GET | `/api/categories` | — | `200 Category[]` active only; `?include_archived=1` → all | |
| PUT | `/api/categories/order` | `{ kind, ids: number[] }` | `200 Category[]` (active of that kind, new order) | 400 `Невірний тип категорії`; 404 `Категорію не знайдено` if any id is not one of the caller's categories; 400 `Невірний порядок категорій` unless `ids` is exactly the set of the caller's active categories of that kind |
| GET | `/api/categories/:id` | — | `200 Category` (active or archived) | 404 `Категорію не знайдено` |
| POST | `/api/categories` | `{ kind, name }` | `201 Category` | 400 `Невірний тип категорії`; 400 name errors; 400 limit (`kindLimitError`); 409 `Категорія з такою назвою вже існує` |
| PATCH | `/api/categories/:id` | `{ name }` | `200 Category` | 404; 400 name errors; 400 `Архівну категорію не можна змінити`; 409 duplicate |
| DELETE | `/api/categories/:id` | — | `200 Category` (now archived; already archived → 200 unchanged) | 404; 400 `Не можна видалити останню активну категорію цього типу` |

- List ordering: `kind` (`income` first), then active before archived, then
  `sort_order`, then `id`.
- Limits count **active** categories only: max 5 `income`, max 10 `expense`
  (`CATEGORY_LIMITS`). At least 1 active per kind must remain.
- New categories get `sort_order = max(sort_order of the user's active categories
  of that kind) + 1` (0 when none) and `color = pickColor(kind, allUserCategories)`.
  Users never set a colour.
- Duplicate-name checks (create + rename) are case-insensitive among the caller's
  **active** categories of the same kind, **excluding the category being renamed**
  (a case-only rename `їжа` → `Їжа` is allowed). A concurrent duplicate that slips
  past the pre-check hits the DB partial unique index → 23505 → 409, not 500.
- Limit / last-active / duplicate checks and the write happen in one DB
  transaction after `lockUser(tx, userId)`.
- Archived categories: hidden from input forms and quick-add, cannot receive new
  transactions, still labelled (with `archived: true`) in history and stats.

## Transactions — `server/routes/transactions.js`

| Method | Path | Body | Success | Errors |
|---|---|---|---|---|
| DELETE | `/api/transactions/last-quick-add` | — | `200 { ok: true, date, removed: Transaction, totals: Totals }` | 404 `Немає швидких записів за сьогодні` |
| GET | `/api/transactions/:id` | — | `200 Transaction` | 404 `Запис не знайдено` |
| POST | `/api/transactions` | `{ category_id, amount, date?, note? }` | `201 { transaction: Transaction, day: DaySummary }` | 400 id/money/date/note; 404 `Категорію не знайдено`; 400 `Категорію архівовано` |
| PATCH | `/api/transactions/:id` | any of `{ category_id, amount, note }` | `200 { transaction, day: DaySummary }` | 404 (transaction or category); 400 validation; 400 `Категорію архівовано` |
| DELETE | `/api/transactions/:id` | — | `200 { ok: true, day: DaySummary \| null }` | 404 `Запис не знайдено` |

- Register `/last-quick-add` **before** `/:id`.
- `date` defaults to today. `note`: optional; must be a string or null; trimmed,
  empty → `null`; max 200 code points → else **400** `Нотатка — до 200 символів`.
- POST upserts the day row and **reopens** it (`is_closed = false`) — adding an
  entry to a closed day reopens it. PATCH/DELETE do not change `is_closed`.
- PATCH: the date cannot be changed. `category_id`, when present and different
  from the current one, must be an active category of the caller (archived → 400
  `Категорію архівовано`, foreign/missing → 404). Editing amount/note of an entry
  whose current category is archived is allowed. Body with none of the fields →
  400 `Немає змін`.
- `DELETE /last-quick-add` (JWT) removes this user's most recent
  `source='quick_add'` transaction dated today (by `created_at desc, id desc`) —
  the in-app "undo" button. Same logic as `DELETE /api/quick-add/last`.
- DELETE returns `day: null` when the (open, now empty) day row was removed.

## Days — `server/routes/days.js`

| Method | Path | Success | Errors |
|---|---|---|---|
| GET | `/api/days` | `200 DaySummary[]` newest first | |
| GET | `/api/days/today` | `200 DaySummary` | 404 `Сьогодні ще немає записів` |
| GET | `/api/days/:date` | `200 DaySummary & { transactions: Transaction[] }` (oldest first: `created_at, id`) | 400 date; 404 `Запис не знайдено` |
| PATCH | `/api/days/:date/close` | `200 DaySummary` (creates the day row as closed if missing) | 400 date |

The old column upserts (`POST /api/days`, `PUT /api/days/:date`) are removed.

## Stats — `server/routes/stats.js`

All aggregates are per user, computed from `days` + `transactions` with SQL sums.
A "recorded day" is a day row (see above). Window dates are computed in Node
(local today) exactly as the old implementation did.

### `GET /api/stats?range=day|week|month` (invalid → `day`)
Windows as before: `day` = last 7 days, `week` = last 8 Monday-start weeks,
`month` = last 6 calendar months (buckets are continuous; empty buckets are 0;
labels as before: `dd.mm` for day/week, `<міс> <yyyy>` for month).
```jsonc
{
  "range": "day", "from": "2026-09-19", "to": "2026-09-25", "hasData": true,
  "chart": [{ "label": "19.09", "income": 0, "expenses": 0 }, …],
  // EXPENSE categories for the pie: every active expense category + archived ones
  // with value > 0 in the window. Ordered active first, then sort_order, id.
  "categories": [{ "key": "12", "id": 12, "label": "Їжа", "color": "#FF4D4D",
                   "archived": false, "value": 120.5, "percent": 40.17 }],
  "totalExpenses": 300,
  "summary": { "avgIncome": 142.86, "avgExpenses": 42.86,
               "bestDay": { "date", "balance" } | null, "worstDay": { "date", "balance" } | null },
  // Table columns: income categories then expense categories (each kind: every
  // active category + archived ones with data in the window; active first, then
  // sort_order, id), key = String(id).
  "columns": [{ "key": "7", "id": 7, "kind": "income", "label": "Дохід",
                "color": "#00C896", "archived": false }],
  // Recorded days in the window, newest first; amounts keyed by category id
  // (a missing key means 0).
  "days": [{ "date": "2026-09-25", "is_closed": 0, "income": 1000, "expenses": 120.5,
             "balance": 879.5, "amounts": { "7": 1000, "12": 120.5 } }]
}
```
`avgIncome`/`avgExpenses` = window total ÷ recorded days (`round2`, 0 when none);
`percent` = category ÷ totalExpenses × 100 (`round2`, 0 when no expenses).
`bestDay`/`worstDay` = recorded day with the highest/lowest balance in the window.

### `GET /api/stats/streak` → `{ "current": 3, "longest": 10 }`
Consecutive recorded days. `current` counts back from today, or from yesterday
when today is not recorded yet.

### `GET /api/stats/calendar?year=YYYY` → `[{ "date", "balance" }]`
One entry per recorded day, oldest first (all years when `year` is absent/invalid).

### `GET /api/stats/monthly?month=YYYY-MM` (invalid → current month)
```jsonc
{ "month": "2026-09", "prevMonth": "2026-08", "hasData": true,
  "totalIncome": 1000, "totalExpenses": 300, "balance": 700,
  "topCategory": { "id": 12, "label": "Їжа", "color": "#FF4D4D", "archived": false, "amount": 120.5 } | null,
  "bestDay": { "date", "balance" } | null, "worstDay": { "date", "balance" } | null,
  "daysLogged": 12,
  "comparison": { "prevIncome": 0, "prevExpenses": 0,
                  "incomeChange": 12.5 | 0 | null, "expensesChange": -3 | 0 | null } }
```
`hasData` = the month has ≥ 1 recorded day. `topCategory` = expense category with
the largest total this month (null when no expenses). `…Change` = % vs previous
month (`round2`); `null` when the previous month is 0 and this month is not, `0`
when both are 0.

## Goals — `server/routes/goals.js` (unchanged behaviour, now per user)

Goal: `{ id, title, target_amount, current_amount, achieved, percent, created_at }`
(`percent` 0–100, 1 decimal). `achieved` is a Postgres generated column
(`target_amount > 0 and current_amount >= target_amount`) — never written by the app.

| Method | Path | Body | Success | Errors |
|---|---|---|---|---|
| GET | `/api/goals` | — | `200 Goal[]` newest first | |
| GET | `/api/goals/:id` | — | `200 Goal` | 404 `Ціль не знайдено` |
| POST | `/api/goals` | `{ title, target_amount }` | `201 Goal` | 400 `Вкажіть назву цілі` / `Назва занадто довга` (> 200) / `Сума цілі має бути більшою за 0` |
| PATCH | `/api/goals/:id` | `{ title?, target_amount?, contribute?, current_amount? }` | `200 Goal` | 404; 400 as below |
| DELETE | `/api/goals/:id` | — | `200 { ok: true }` | 404 |

PATCH: `title` present but empty/whitespace → 400 `Вкажіть назву цілі`;
`target_amount` → `parseAmount` (> 0) else 400 `Сума цілі має бути більшою за 0`;
`contribute` → `parseAmount` (> 0) else 400 `Сума має бути додатнім числом`, added
in SQL (`current_amount + $1`); `current_amount` → `parseAmount(v, { allowZero: true })`
else the same 400. A resulting amount above `999999999999.99` → the same 400.

## Quick-add (Apple Shortcuts) — `server/routes/quick-add.js`

Authenticated by header `X-API-Key: <personal key>` (no JWT). The key is looked
up by `hashQuickAddKey(key)` in `users.quick_add_key_hash`. Missing/unknown key →
**401** `Невірний ключ API`.

### `POST /api/quick-add`
Body `{ "category": "Їжа" | 12, "amount": 250, "note"?: "…", "kind"?: "income" | "expense" }`
- `kind`, if present, must be `income` or `expense` (else **400**
  `Невірний тип категорії`) and restricts both the name and the id match to that kind.
- `category` as a JSON **number** = category id. As a **string**: matched by name
  (trimmed, case-insensitive via SQL `lower()`) among the user's **active**
  categories; if no name matches and the string is all digits, it is tried as an id.
- If (without `kind`) a name matches both an income and an expense category →
  **400** `Неоднозначна категорія: вкажіть kind (income або expense)`.
- Unknown, archived, out-of-range id, or another user's category → **400**
  `Невідома категорія`. Amount/note validation as for transactions.
- Creates a `source: 'quick_add'` transaction dated today; reopens today's day.
- **200** `{ "ok": true, "date": "2026-09-25", "transaction": Transaction, "totals": Totals }`
  (`totals` = today's income / expenses / balance after the write).

### `DELETE /api/quick-add/last`
Removes the key owner's most recent `quick_add` transaction **of today**.
**200** `{ "ok": true, "date", "removed": Transaction, "totals": Totals }`;
none today → **404** `Немає швидких записів за сьогодні`.

## Client flow mapping (builder C)

- Routes: `/login`, `/register` (public); `/`, `/day`, `/day/:date`, `/stats`,
  `/goals`, `/settings` (behind the token gate).
- WelcomePage: one primary button opens `/day` (label `🌅 Почати новий день` when
  today has no day row, `📝 Продовжити сьогодні` when it has) — no overwrite
  confirm, no automatic `closeDay`, no `?fresh=1`. Shows the user's email and a
  Settings button next to logout. "Останній день" widget = newest day with
  `is_closed === 1`, balance from `DaySummary.balance`.
- DayPage (today): add-entry form (active categories picker grouped by kind,
  amount, optional note), list of the day's entries (`GET /api/days/:date`, 404 =
  empty list) with delete, live summary from the server's `DaySummary`,
  `Завершити день` → `PATCH /close`, undo-last-quick-add button when today has a
  `quick_add` entry. Past day (`/day/:date`): read-only until `✏️ Редагувати`,
  then add/delete allowed (adding reopens the day, per spec).
- Settings: email, logout, quick-add key (generate/regenerate with confirm, show
  once with copy, revoke), categories per kind with counters `n/5` and `n/10`,
  add, rename, reorder (↑/↓ → `PUT /order`), archive (disabled for the last active
  of a kind), archived list read-only.
- Limits are mirrored client-side (`{ income: 5, expense: 10 }`); the server is
  authoritative — always show server `error` messages.
- 401 interceptor must ignore `/auth/login` and `/auth/register` failures.

## Server module contracts

- `server/app.js` (A) — `export function createApp()` returns the Express app
  (mount table above). `DATABASE_URL` and `JWT_SECRET` must be set **before**
  importing it (db.js reads `DATABASE_URL` at import time).
- `server/index.js` (A) — loads `server/.env`, checks required env
  (`DATABASE_URL`, `JWT_SECRET`), runs migrations, then `createApp().listen(PORT)`.
- `server/middleware/auth.js` (A) — `requireAuth` (sets `req.userId`).
- `server/lib/password.js` (A) — `hashPassword(pw)` / `verifyPassword(pw, stored)`
  (node `crypto.scrypt`, random 16-byte salt, `timingSafeEqual`, self-describing
  `scrypt$N$r$p$salt$hash` encoding) and `DUMMY_PASSWORD_HASH` for the
  unknown-email login path.
- `server/lib/ledger.js` (B) — day upsert/close/cleanup, day summary SQL, shared by
  transactions.js, days.js, quick-add.js.
- `server/lib/quickAddKey.js` — `generateQuickAddKey()` → `{ key, hash }`,
  `hashQuickAddKey(key)`.
- `server/lib/categories.js` — kinds, limits, palette, name validation,
  registration-categories resolution, `lockUser`, `insertInitialCategories`.
- `server/lib/money.js` — `parseAmount`, `toMoney`, `round2`.
- `server/lib/dates.js` — `todayStr`, `toDateStr`, `isValidDateStr`, `isValidMonthStr`.
- `server/db.js` — `db` (drizzle) and `pool` (close with `pool.end()` in tests).
