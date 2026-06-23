import { useEffect, useState } from 'react';
import { getMonthly } from '../api.js';
import { formatUAH } from '../utils/format.js';
import { formatShortDate } from '../utils/dates.js';

const MONTHS_FULL = [
  'Січень', 'Лютий', 'Березень', 'Квітень', 'Травень', 'Червень',
  'Липень', 'Серпень', 'Вересень', 'Жовтень', 'Листопад', 'Грудень',
];

function currentMonthStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function monthTitle(month) {
  const [y, m] = month.split('-').map(Number);
  return `${MONTHS_FULL[m - 1]} ${y}`;
}

// % comparison chip: green/▲ for up, red/▼ for down, neutral when no baseline.
function ChangeChip({ value, invert }) {
  if (value === null || value === undefined) {
    return <span className="change-chip neutral">— новий місяць</span>;
  }
  const up = value > 0;
  // For income, up is good (green); for expenses, up is bad (red) -> invert.
  const good = invert ? !up : up;
  if (value === 0) return <span className="change-chip neutral">0%</span>;
  return (
    <span className={`change-chip ${good ? 'positive' : 'negative'}`}>
      {up ? '▲' : '▼'} {Math.abs(value)}%
    </span>
  );
}

export default function MonthlyReport() {
  const [month, setMonth] = useState(currentMonthStr());
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    getMonthly(month)
      .then((d) => active && setData(d))
      .catch(() => active && setData(null))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [month]);

  return (
    <section className="card monthly-card">
      <div className="monthly-head">
        <h2 className="card-title" style={{ marginBottom: 0 }}>Підсумок місяця</h2>
        <input
          type="month"
          className="monthly-picker"
          value={month}
          max={currentMonthStr()}
          onChange={(e) => e.target.value && setMonth(e.target.value)}
        />
      </div>

      {loading ? (
        <div className="stats-placeholder small">Завантаження…</div>
      ) : !data || !data.hasData ? (
        <div className="stats-placeholder small">Немає записів за {monthTitle(month)} 🗓️</div>
      ) : (
        <div className="monthly-body">
          <div className="monthly-title">{monthTitle(data.month)}</div>

          <div className="monthly-grid">
            <div className="monthly-tile">
              <div className="monthly-tile-label">Доходи</div>
              <div className="monthly-tile-value income">{formatUAH(data.totalIncome)}</div>
              <ChangeChip value={data.comparison.incomeChange} />
            </div>
            <div className="monthly-tile">
              <div className="monthly-tile-label">Витрати</div>
              <div className="monthly-tile-value expense">{formatUAH(data.totalExpenses)}</div>
              <ChangeChip value={data.comparison.expensesChange} invert />
            </div>
            <div className="monthly-tile monthly-tile-wide">
              <div className="monthly-tile-label">Чистий баланс</div>
              <div className={`monthly-tile-value big ${data.balance >= 0 ? 'positive' : 'negative'}`}>
                {data.balance >= 0 ? '+' : ''}{formatUAH(data.balance)}
              </div>
            </div>
          </div>

          <ul className="monthly-facts">
            <li>
              <span>🏆 Найбільша категорія витрат</span>
              <strong>
                {data.topCategory ? `${data.topCategory.label} — ${formatUAH(data.topCategory.amount)}` : '—'}
              </strong>
            </li>
            <li>
              <span>📈 Найкращий день</span>
              <strong className="positive">
                {data.bestDay ? `${formatShortDate(data.bestDay.date)} (+${formatUAH(data.bestDay.balance)})` : '—'}
              </strong>
            </li>
            <li>
              <span>📉 Найгірший день</span>
              <strong className={data.worstDay && data.worstDay.balance < 0 ? 'negative' : ''}>
                {data.worstDay
                  ? `${formatShortDate(data.worstDay.date)} (${data.worstDay.balance >= 0 ? '+' : ''}${formatUAH(data.worstDay.balance)})`
                  : '—'}
              </strong>
            </li>
            <li>
              <span>🗓️ Днів відмічено</span>
              <strong>{data.daysLogged}</strong>
            </li>
          </ul>
        </div>
      )}
    </section>
  );
}
