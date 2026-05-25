# fin_monitoring — персональний моніторинг фінансів 💰

Веб-застосунок для щоденного обліку доходів і витрат.
Інтерфейс українською, валюта — гривня (₴).

**Стек:** React (Vite) + Node.js (Express) + SQLite (better-sqlite3).

## Структура

```
fin_monitoring/
├── client/   # React (Vite) — порт 5173
├── server/   # Express API  — порт 3001
└── database.sqlite   # створюється автоматично при першому запуску
```

## Запуск

Потрібен Node.js 20.19+ (рекомендовано 22+).

```bash
npm install        # ставить залежності для root + client + server (npm workspaces)
npm run dev        # одночасно піднімає сервер (3001) і клієнт (5173)
```

Відкрити: <http://localhost:5173>

Окремо:

```bash
npm run dev:server   # тільки API
npm run dev:client   # тільки фронтенд
npm run build        # продакшн-збірка клієнта
```

## Сторінки

- **Welcome** — «Почати новий день», «Продовжити сьогодні», «Статистика», віджет останнього дня, випадкова цитата.
- **DayPage** — форма доходів/витрат із живим підсумком, збереженням і завершенням дня.
- **StatisticsPage** — графіки (доходи vs витрати, розподіл витрат), зведені картки та таблиця по днях із перемикачем День / Тиждень / Місяць.

## API

| Метод | Маршрут | Опис |
|-------|---------|------|
| GET | `/api/days` | усі дні |
| GET | `/api/days/today` | запис за сьогодні (або 404) |
| GET | `/api/days/:date` | запис за датою (YYYY-MM-DD) |
| POST | `/api/days` | створити день (upsert) |
| PUT | `/api/days/:date` | оновити день (upsert) |
| PATCH | `/api/days/:date/close` | завершити день (`is_closed = 1`) |
| GET | `/api/stats?range=day\|week\|month` | агрегована статистика |

## Налаштування

`server/.env`:

```
PORT=3001
DB_PATH=./database.sqlite
```
