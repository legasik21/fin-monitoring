export const INCOME_FIELDS = [
  { key: 'income_main', label: 'Основний дохід', placeholder: 'напр. зарплата, фріланс' },
  { key: 'income_tips', label: 'Чайові / бонуси', placeholder: 'додаткові надходження' },
];

export const EXPENSE_FIELDS = [
  {
    key: 'expense_food_out',
    label: 'Їжа (кафе, ресторани)',
    icon: '🍽️',
    placeholder: 'скільки витратив на їжу поза домом',
  },
  {
    key: 'expense_food_market',
    label: 'Продукти (магазин)',
    icon: '🛒',
    placeholder: 'супермаркет, ринок',
  },
  {
    key: 'expense_no_reason',
    label: 'Витрати «ні за що»',
    icon: '🤷',
    placeholder: 'дрібниці, імпульсивні покупки',
  },
  {
    key: 'expense_gas',
    label: 'Пальне',
    icon: '⛽',
    placeholder: 'заправка, пальне',
  },
  {
    key: 'expense_wants',
    label: 'Фізичні хотілки',
    icon: '🛍️',
    placeholder: 'гаджети, одяг, парфуми...',
  },
];

// All amount columns, used by the statistics table header/rows.
export const ALL_AMOUNT_FIELDS = [...INCOME_FIELDS, ...EXPENSE_FIELDS];

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
