# fin-monitoring — багатокористувацька система обліку фінансів

Веб-застосунок для щоденного обліку доходів і витрат. Кожен користувач зберігає свої дані окремо, може налаштувати власні категорії і переглядати статистику за різні періоди.

**Інтерфейс українською мовою. Валюта — гривня (₴).**

## Стек

- **Backend:** Node.js 22 + Express 5
- **Фронтенд:** React 18 + Vite 8
- **БД:** PostgreSQL 16 + Drizzle ORM 0.45
- **Deploy:** Docker + Docker Compose + Traefik
- **Автентифікація:** email + пароль (scrypt хеш), JWT 30 днів

## Особливості

### Акаунти
- Реєстрація без запрошення (відкрита для всіх)
- Електронна пошта + пароль (мін. 8 символів)
- Паролі захешовані `crypto.scrypt` з випадковою сіллю
- JWT токени на 30 днів
- Немає відновлення пароля / відправки листів

### Категорії та ліміти
- Кожен користувач створює власні категорії доходів та витрат
- За замовчуванням: 1 категорія доходу («Дохід») та 1 витрат («Витрати»)
- Можна додати власні під час реєстрації або пізніше в Налаштуваннях
- **Активні ліміти:** макс 5 категорій доходу, макс 10 категорій витрат
- Мінімум 1 активна категорія на кожен тип
- Архівування замість видалення: записи залишаються в історії й статистиці
- Автоматичне присвоєння кольорів при створенні

### Облік (Ledger)
- Запис кожної окремої операції (дохід або витрата)
- Збереження дати, суми, категорії та додаткової нотатки
- Додавання й видалення записів (редагування — лише через API `PATCH /api/transactions/:id`)
- Скасування останньої операції швидкого додавання
- Закриття дня (додавання запису в закритий день автоматично його відкриває)

### Статистика
- Графік доходів vs витрат (день / тиждень / місяць)
- Розподіл витрат за категоріями (колова діаграма)
- Таблиця «Деталізація за днями» із сумами по категоріях
- Серія послідовних днів з записами
- Місячний звіт та порівняння з попереднім місяцем
- Теплова карта балансу (Календар балансу) по роках

### Цілі (Goals)
- Створення та відстеження цілей збереження
- Прогрес у відсотках, внески, позначка досягнутої цілі

### Швидке додавання
- Особистий ключ API для кожного користувача
- Інтеграція з Apple Shortcuts
- Додавання записів одним дотиком з головного екрана iPhone
- Скасування останнього швидкого додавання також через Shortcut

## Структура проекту

```
fin-monitoring/
├── client/                    # React + Vite фронтенд
│   ├── src/
│   │   ├── pages/            # LoginPage, RegisterPage, WelcomePage, DayPage, StatisticsPage, GoalsPage, SettingsPage
│   │   ├── components/       # CalendarHeatmap, MonthlyReport
│   │   ├── api.js            # axios клієнт
│   │   ├── constants.js       # ліміти категорій, дефолтні назви, цитати
│   │   └── utils/            # допоміжні функції
│   ├── package.json
│   └── vite.config.js
├── server/                    # Express API
│   ├── index.js              # точка входу, завантаження .env, міграції
│   ├── app.js                # маршрути, обробка помилок
│   ├── schema.js             # Drizzle схема БД
│   ├── db.js                 # підключення БД
│   ├── migrate.js            # запуск міграцій
│   ├── drizzle.config.js     # налаштування Drizzle CLI
│   ├── serialize.js          # форматування відповідей
│   ├── routes/
│   │   ├── auth.js           # реєстрація, логін, мій акаунт, швидкий ключ
│   │   ├── categories.js     # операції з категоріями
│   │   ├── transactions.js   # операції з записами
│   │   ├── days.js           # дні й закриття
│   │   ├── stats.js          # статистика й графіки
│   │   ├── goals.js          # цілі
│   │   └── quick-add.js      # швидке додавання
│   ├── middleware/
│   │   └── auth.js           # JWT перевірка
│   ├── lib/
│   │   ├── password.js       # scrypt хешування й перевірка
│   │   ├── quickAddKey.js    # генерація й хешування ключів
│   │   ├── categories.js     # валідація, ліміти, кольори
│   │   ├── money.js          # збереження точних грошей (numeric 14,2)
│   │   ├── dates.js          # дати у часовому поясі Київ
│   │   └── ledger.js         # операції з днями й записами
│   ├── drizzle/              # міграції та інше, створюється drizzle-kit
│   ├── test/                 # інтеграційні тести node:test
│   ├── package.json
│   └── .env.example
├── scripts/
│   ├── test.sh               # запуск тестів у Docker
│   └── backup-db.sh          # щоденний бекап PostgreSQL
├── docker-compose.yml         # production (app + db + Traefik)
├── Dockerfile                 # multi-stage збірка
├── .env.example              # runtime конфіг для compose
├── package.json              # root workspace
├── SHORTCUT_SETUP.md         # налаштування Apple Shortcuts
└── docs/
    └── API.md                # API контракт
```

## Запуск

### Локальний розвиток

**Потрібне:** Docker, Docker Compose (хост Node занадто старий для Vite 8 і цього репо).

Встановіть тестову Postgres й запустіть сервер + клієнт у контейнері:

```bash
# Створіть окрему мережу й контейнер БД
docker network create fin-dev
docker run -d --name fin-monitoring-dev-db --network fin-dev \
  -e POSTGRES_USER=fin -e POSTGRES_PASSWORD=fin -e POSTGRES_DB=fin_monitoring \
  postgres:16-alpine

# Запустіть сервер і клієнт (concurrently) у контейнері node:22
docker run --rm -it --network fin-dev \
  -p 3001:3001 -p 5173:5173 \
  --user "$(id -u):$(id -g)" -e HOME=/tmp -e TZ=Europe/Kyiv \
  -e DATABASE_URL=postgres://fin:fin@fin-monitoring-dev-db:5432/fin_monitoring \
  -e JWT_SECRET=dev-only-secret \
  -v "$PWD":/app -w /app \
  node:22-bookworm-slim bash -c \
  'npm ci && npx concurrently "npm run dev -w server" "npm run dev -w client -- --host 0.0.0.0"'

# Коли закінчите, очистіть:
docker rm -f fin-monitoring-dev-db
docker network rm fin-dev
```

**Адреса:** http://localhost:5173

### Тести

```bash
scripts/test.sh
```

Запускається у Docker проти тимчасової PostgreSQL, виконує міграції й прогонює node:test. Тестова БД видаляється після завершення.

### Продакшн-збірка

```bash
docker compose build app
docker compose up -d
```

Для збірки використовується `node:22-bookworm-slim`, Drizzle міграції запускаються автоматично при старті контейнера `app`.

## Змінні середовища

| Змінна | Де встановлювати | Опис | Приклад |
|--------|------------------|------|---------|
| `DATABASE_URL` | `.env` (compose) + `server/.env` (local) | З'єднання з PostgreSQL; пароль повинен збігатися з `POSTGRES_PASSWORD` | `postgres://fin:пароль@fin-monitoring-db:5432/fin_monitoring` |
| `JWT_SECRET` | `.env` (compose) + `server/.env` (local) | Секрет для підпису JWT | `openssl rand -hex 32` |
| `POSTGRES_USER` | `.env` (compose) | Користувач БД | `fin` |
| `POSTGRES_PASSWORD` | `.env` (compose) | Пароль БД | `openssl rand -hex 24` |
| `POSTGRES_DB` | `.env` (compose) | Назва БД | `fin_monitoring` |
| `PORT` | docker-compose.yml / `server/.env` | Порт Express (необовʼязково, за замовчуванням 3001) | `3001` |
| `NODE_ENV` | docker-compose.yml | Режим (`production`, `test`, etc.) | `production` |
| `TZ` | docker-compose.yml | Часовий пояс для "сьогодні" | `Europe/Kyiv` |

Приклади дивіться в `.env.example` і `server/.env.example`.

## Розгортання (Production)

### Передумови
- Docker, Docker Compose
- Traefik на мережі `traefik-public`
- Папка `/home/claude/backups/fin-monitoring/` для бекапів

### Розгортання

Розгортання відбувається тільки з існуючого checkout на сервері: `/home/claude/stacks/fin-monitoring`

1. Перейдіть до директорії:
   ```bash
   cd /home/claude/stacks/fin-monitoring
   ```

2. Створіть або оновіть `.env` (тільки при першому розгортанні):
   ```bash
   [ -f .env ] || cp .env.example .env
   chmod 600 .env
   ```
   Встановіть у `.env`:
   - `POSTGRES_PASSWORD=` генеруйте: `openssl rand -hex 24`
   - `DATABASE_URL=postgres://fin:<ТОЙ_ЖЕ_ПАРОЛЬ>@fin-monitoring-db:5432/fin_monitoring`
   - `JWT_SECRET=` генеруйте: `openssl rand -hex 32`

3. Збудуйте й запустіть:
   ```bash
   docker compose build app
   docker compose up -d
   ```

4. Перевірте здоров'я:
   ```bash
   curl https://fin-mon.cyberskill.online/api/health
   # -> {"ok":true}
   ```

Міграції БД запускаються автоматично при старті контейнера `app`.

### Скидання БД (деструктивне)

```bash
docker compose stop app db
docker compose rm -f app db
docker volume rm fin-monitoring-db-data
docker compose up -d
```

**УВАГА:** це видаляє ВСЕ дані! Використовуйте тільки в екстремальних ситуаціях.

## Бекапи

### Графік

Автоматичний щоденний бекап із crontab користувача `claude`:

```
30 3 * * * /home/claude/stacks/fin-monitoring/scripts/backup-db.sh >> /home/claude/backups/fin-monitoring/backup.log 2>&1
```

Запускається щодня о 03:30 UTC. Зберігаються 14 найновіших дампів.

Для ручного запуску: `/home/claude/stacks/fin-monitoring/scripts/backup-db.sh`. Дампи зберігаються з правами доступу 600 (umask 077).

### Місцезнаходження

```
/home/claude/backups/fin-monitoring/fin-monitoring-YYYYMMDD-HHMM.sql.gz
```

### Відновлення (деструктивне)

**Метод 1: видалення й відновлення з дампу**

```bash
# Зупиніть app і db
docker compose stop app

# Видаліть контейнер db і його volume
docker compose rm -f db
docker volume rm fin-monitoring-db-data

# Запустіть порожню БД
docker compose up -d db

# Дочекайтеся, поки db буде готова (перевірте: docker compose ps db → healthy)
docker compose ps db

# Відновіть з дампу (замість YYYYMMDD-HHMM на реальну дату):
gunzip -c /home/claude/backups/fin-monitoring/fin-monitoring-YYYYMMDD-HHMM.sql.gz | \
  docker exec -i fin-monitoring-db sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"'

# Запустіть app (міграції не перезапустяться, БД вже заповнена)
docker compose up -d app
```

**Метод 2: очищення схем під час роботи db (швидше)**

```bash
# Зупиніть app
docker compose stop app

# Очистіть схеми (db залишається запущеною). pg_dump не створює схему public,
# тож її треба створити заново порожньою перед відновленням:
docker exec fin-monitoring-db sh -c \
  'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
    -c "DROP SCHEMA IF EXISTS public CASCADE" \
    -c "DROP SCHEMA IF EXISTS drizzle CASCADE" \
    -c "CREATE SCHEMA public"'

# Відновіть з дампу:
gunzip -c /home/claude/backups/fin-monitoring/fin-monitoring-YYYYMMDD-HHMM.sql.gz | \
  docker exec -i fin-monitoring-db sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"'

# Запустіть app
docker compose up -d app
```

## API

Повний каталог маршрутів. Детальний контракт з помилками й телами відповідей — див. [docs/API.md](docs/API.md).

| Метод | Шлях | Опис | Автентифікація |
|-------|------|------|-----------------|
| GET | `/api/health` | Перевірка здоров'я | — |
| POST | `/api/auth/register` | Реєстрація з email + пароль | — |
| POST | `/api/auth/login` | Логін, видача JWT | — |
| GET | `/api/auth/me` | Мій акаунт (email, статус quick-add key) | JWT |
| POST | `/api/auth/quick-add-key` | Генерація нового ключа quick-add | JWT |
| DELETE | `/api/auth/quick-add-key` | Відкликання ключа | JWT |
| GET | `/api/categories` | Список активних категорій користувача | JWT |
| GET | `/api/categories?include_archived=1` | Список всіх категорій (активних + архівних) | JWT |
| GET | `/api/categories/:id` | Одна категорія | JWT |
| POST | `/api/categories` | Створити категорію | JWT |
| PATCH | `/api/categories/:id` | Перейменувати категорію | JWT |
| DELETE | `/api/categories/:id` | Архівувати категорію | JWT |
| PUT | `/api/categories/order` | Змінити порядок активних категорій | JWT |
| GET | `/api/transactions/:id` | Один запис | JWT |
| POST | `/api/transactions` | Створити запис | JWT |
| PATCH | `/api/transactions/:id` | Оновити запис (категорія, сума, нотатка) | JWT |
| DELETE | `/api/transactions/:id` | Видалити запис | JWT |
| DELETE | `/api/transactions/last-quick-add` | Скасувати останній швидкий запис сьогодні | JWT |
| GET | `/api/days` | Всі дні користувача (новіші першим) | JWT |
| GET | `/api/days/today` | День сьогодні (або 404) | JWT |
| GET | `/api/days/:date` | День за датою (YYYY-MM-DD) з записами | JWT |
| PATCH | `/api/days/:date/close` | Закрити день | JWT |
| GET | `/api/stats?range=day\|week\|month` | Графік і таблиця (за замовчуванням `day`) | JWT |
| GET | `/api/stats/streak` | Поточна й найдовша серія днів | JWT |
| GET | `/api/stats/calendar?year=YYYY` | Баланс по днях для теплової карти: без `year` — усі роки, з `year=YYYY` — лише цей рік | JWT |
| GET | `/api/stats/monthly?month=YYYY-MM` | Місячний звіт | JWT |
| GET | `/api/goals` | Всі цілі користувача | JWT |
| GET | `/api/goals/:id` | Одна ціль | JWT |
| POST | `/api/goals` | Створити ціль | JWT |
| PATCH | `/api/goals/:id` | Оновити ціль (назва, сума, прогрес) | JWT |
| DELETE | `/api/goals/:id` | Видалити ціль | JWT |
| POST | `/api/quick-add` | Додати запис (з X-API-Key в заголовку) | X-API-Key |
| DELETE | `/api/quick-add/last` | Скасувати останній швидкий запис сьогодні (з X-API-Key) | X-API-Key |

**Усі помилки** повертаються як `{ "error": "<українське повідомлення>" }`.

**Повний контракт:** див. [docs/API.md](docs/API.md) для деталей про тіла запитів, відповідей, кодів помилок.

## Швидке додавання (Apple Shortcuts)

Див. [SHORTCUT_SETUP.md](SHORTCUT_SETUP.md) для налаштування персонального ключа й інтеграції з iOS.

## Розробка

### Drizzle міграції

Генеруйте нові міграції у контейнері node:22 (з repo root):

```bash
docker run --rm -v "$PWD":/app -w /app/server \
  --user "$(id -u):$(id -g)" -e HOME=/tmp \
  node:22-bookworm-slim npx drizzle-kit generate
```

Створює нові міграції в `server/drizzle/` за змінами в `server/schema.js`. БД не потрібна для generate.

### Тестування

```bash
scripts/test.sh                  # весь набір тестів
scripts/test.sh test/auth.test.js   # один файл
```

Тести запускаються в Docker з тимчасовою PostgreSQL, ніколи проти production.

---

**Останнє оновлення:** 2026-09-25
