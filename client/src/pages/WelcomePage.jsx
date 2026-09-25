import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getAllDays, clearToken, getStreak, getGoals, getMe } from '../api.js';
import { todayStr, formatShortDate } from '../utils/dates.js';
import { formatUAH, formatBalance } from '../utils/format.js';
import { randomQuote } from '../constants.js';

export default function WelcomePage() {
  const navigate = useNavigate();
  const quote = useMemo(() => randomQuote(), []);
  const [me, setMe] = useState(null);
  const [today, setToday] = useState(null); // today's DaySummary or null
  const [lastClosed, setLastClosed] = useState(null);
  const [streak, setStreak] = useState(null); // { current, longest }
  const [nearestGoal, setNearestGoal] = useState(null);
  const [loading, setLoading] = useState(true);
  const mountedRef = useRef(true);

  const refresh = async () => {
    const date = todayStr();
    const [allDays, streakData, goals, user] = await Promise.all([
      getAllDays().catch(() => []),
      getStreak().catch(() => null),
      getGoals().catch(() => []),
      getMe().catch(() => null),
    ]);
    if (!mountedRef.current) return; // component unmounted mid-fetch
    setMe(user);
    // A day row for today exists once anything was recorded (or it was closed);
    // that decides the label of the single "go to today" button.
    setToday(allDays.find((d) => d.date === date) || null);
    const closed = allDays
      .filter((d) => d.is_closed === 1)
      .sort((a, b) => b.date.localeCompare(a.date));
    setLastClosed(closed[0] || null);
    setStreak(streakData);
    // Nearest active goal = the unfinished goal closest to completion.
    const active = goals
      .filter((g) => !g.achieved)
      .sort((a, b) => b.percent - a.percent);
    setNearestGoal(active[0] || null);
    setLoading(false);
  };

  useEffect(() => {
    mountedRef.current = true;
    refresh();
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const handleLogout = () => {
    clearToken();
    navigate('/login', { replace: true });
  };

  // Balance comes from the server's DaySummary — the client never sums money.
  const lastBalance = lastClosed ? lastClosed.balance : null;

  return (
    <div className="page welcome">
      <div className="welcome-inner fade-in-up">
        <div className="welcome-topbar">
          <span className="user-email" title={me?.email}>
            {me?.email || ' '}
          </span>
          <div className="welcome-topbar-actions">
            <button className="btn btn-ghost btn-sm" onClick={() => navigate('/settings')}>
              ⚙️ Налаштування
            </button>
            <button className="btn btn-ghost btn-sm" onClick={handleLogout}>
              Вийти
            </button>
          </div>
        </div>

        <header className="welcome-header">
          <div className="logo-badge">₴</div>
          <h1>Фінансовий моніторинг</h1>
          <p className="quote">«{quote}»</p>
        </header>

        {streak && (
          <section className="streak-banner">
            {streak.current > 0 ? (
              <div className="streak-main">
                <span className="streak-fire">🔥</span>
                <span className="streak-count">{streak.current}</span>
                <span className="streak-text">{streak.current === 1 ? 'день поспіль' : 'днів поспіль'}</span>
              </div>
            ) : (
              <div className="streak-main streak-idle">
                <span className="streak-fire">✨</span>
                <span className="streak-text">Відміть сьогодні — почни серію!</span>
              </div>
            )}
            {streak.longest > 0 && (
              <div className="streak-record">Рекорд: {streak.longest} {streak.longest === 1 ? 'день' : 'днів'}</div>
            )}
          </section>
        )}

        <div className="welcome-actions">
          {/* Entries are saved one by one, so there is nothing to overwrite or
              auto-close: both labels simply open today's ledger. */}
          <button className="btn btn-primary btn-lg" onClick={() => navigate('/day')} disabled={loading}>
            {today ? (
              <>
                <span className="btn-emoji">📝</span> Продовжити сьогодні
              </>
            ) : (
              <>
                <span className="btn-emoji">🌅</span> Почати новий день
              </>
            )}
          </button>

          <button className="btn btn-ghost btn-lg" onClick={() => navigate('/stats')}>
            <span className="btn-emoji">📊</span> Статистика
          </button>

          <button className="btn btn-ghost btn-lg" onClick={() => navigate('/goals')}>
            <span className="btn-emoji">🎯</span> Цілі
          </button>
        </div>

        {nearestGoal && (
          <section
            className="goal-widget"
            role="button"
            tabIndex={0}
            onClick={() => navigate('/goals')}
            onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && navigate('/goals')}
          >
            <div className="goal-widget-head">
              <span className="goal-widget-title">🎯 {nearestGoal.title}</span>
              <span className="goal-widget-percent">{nearestGoal.percent}%</span>
            </div>
            <div className="goal-progress">
              <div className="goal-progress-fill" style={{ width: `${nearestGoal.percent}%` }} />
            </div>
            <div className="goal-widget-amounts">
              {formatUAH(nearestGoal.current_amount)} з {formatUAH(nearestGoal.target_amount)}
            </div>
          </section>
        )}

        <section className="last-day-widget">
          <div className="last-day-title">Останній день</div>
          {loading ? (
            <div className="last-day-empty">Завантаження…</div>
          ) : lastClosed ? (
            <div className="last-day-body">
              <span className="last-day-date">{formatShortDate(lastClosed.date)}</span>
              <span className={`last-day-balance ${lastBalance >= 0 ? 'positive' : 'negative'}`}>
                {formatBalance(lastBalance)}
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
