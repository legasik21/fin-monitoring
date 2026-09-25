// Mirrors of the server-side rules (server/lib/categories.js, docs/API.md). The
// server stays authoritative — these only drive counters, disabled buttons and
// early hints, and every server `error` message is still shown as-is.

// Max ACTIVE categories per kind (archived ones do not count).
export const CATEGORY_LIMITS = { income: 5, expense: 10 };

export const CATEGORY_NAME_MAX = 50;
export const NOTE_MAX = 200;
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;

// What the server creates for a kind left empty at registration.
export const DEFAULT_CATEGORY_NAMES = { income: 'Дохід', expense: 'Витрати' };

export const CATEGORY_KINDS = ['income', 'expense'];

export const KIND_LABELS = { income: 'Доходи', expense: 'Витрати' };

export const QUOTES = [
  'Гроші люблять рахунок 💰',
  'Контролюй витрати — і гроші працюватимуть на тебе.',
  'Не витрачай те, чого ще не заробив.',
  'Маленька економія сьогодні — велика свобода завтра.',
  'Багатство — це не скільки заробив, а скільки зберіг.',
  'Кожна гривня має знати своє місце.',
  'Веди облік — і фінанси перестануть бути загадкою.',
];

export function randomQuote() {
  return QUOTES[Math.floor(Math.random() * QUOTES.length)];
}
