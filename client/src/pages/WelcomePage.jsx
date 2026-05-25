import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getAllDays, getDay, closeDay, clearToken } from '../api.js';
import { todayStr, formatShortDate } from '../utils/dates.js';
import { formatUAH, toAmount } from '../utils/format.js';
import { randomQuote } from '../constants.js';

function balanceOf(row) {
  const income = toAmount(row.income_main) + toAmount(row.income_tips);
  const expenses =
    toAmount(row.expense_food_out) +
    toAmount(row.expense_food_market) +
    toAmount(row.expense_no_reason) +
    toAmount(row.expense_gas);
  return income - expenses;
}

export default function WelcomePage() {
  const navigate = useNavigate();
  const quote = useMemo(() => randomQuote(), []);
  const [today, setToday] = useState(null); // today's record or null
  const [lastClosed, setLastClosed] = useState(null);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    const date = todayStr();
    const [allDays, todayRow] = await Promise.all([
      getAllDays().catch(() => []),
      getDay(date).catch(() => null),
    ]);
    setToday(todayRow);
    const closed = allDays
      .filter((d) => d.is_closed === 1)
      .sort((a, b) => b.date.localeCompare(a.date));
    setLastClosed(closed[0] || null);
    setLoading(false);
  };

  useEffect(() => {
    refresh();
  }, []);

  const canContinue = today && today.is_closed === 0;

  const handleStartNewDay = async () => {
    const date = todayStr();
    if (today) {
      if (today.is_closed === 1) {
        const ok = window.confirm('Сьогоднішній день вже завершено. Хочете перезаписати?');
        if (!ok) return;
      } else {
        // Open session exists — finalise it before starting fresh.
        await closeDay(date).catch(() => {});
      }
    }
    navigate('/day?fresh=1');
  };

  const handleContinue = () => {
    if (!canContinue) return;
    navigate('/day');
  };

  const handleLogout = () => {
    clearToken();
    navigate('/login', { replace: true });
  };

  const lastBalance = lastClosed ? balanceOf(lastClosed) : null;

  return (
    <div className="page welcome">
      <button className="btn btn-ghost btn-sm logout-btn" onClick={handleLogout}>
        Вийти
      </button>
      <div className="welcome-inner fade-in-up">
        <header className="welcome-header">
          <div className="logo-badge">₴</div>
          <h1>Фінансовий моніторинг</h1>
          <p className="quote">«{quote}»</p>
        </header>

        <div className="welcome-actions">
          <button className="btn btn-primary btn-lg" onClick={handleStartNewDay}>
            <span className="btn-emoji">🌅</span> Почати новий день
          </button>

          <button
            className="btn btn-secondary btn-lg"
            onClick={handleContinue}
            disabled={!canContinue}
            title={!canContinue ? 'Сьогодні ще немає записів' : undefined}
          >
            <span className="btn-emoji">📝</span> Продовжити сьогодні
          </button>

          <button className="btn btn-ghost btn-lg" onClick={() => navigate('/stats')}>
            <span className="btn-emoji">📊</span> Статистика
          </button>
        </div>

        <section className="last-day-widget">
          <div className="last-day-title">Останній день</div>
          {loading ? (
            <div className="last-day-empty">Завантаження…</div>
          ) : lastClosed ? (
            <div className="last-day-body">
              <span className="last-day-date">{formatShortDate(lastClosed.date)}</span>
              <span className={`last-day-balance ${lastBalance >= 0 ? 'positive' : 'negative'}`}>
                {lastBalance >= 0 ? '+' : ''}
                {formatUAH(lastBalance)}
              </span>
            </div>
          ) : (
            <div className="last-day-empty">Ще немає завершених днів</div>
          )}
        </section>
      </div>
    </div>
  );
}
