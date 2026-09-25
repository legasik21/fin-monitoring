import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getCalendar } from '../api.js';
import { toDateStr, formatShortDate } from '../utils/dates.js';
import { formatUAH } from '../utils/format.js';

const MONTHS_SHORT = [
  'січ', 'лют', 'бер', 'кві', 'тра', 'чер',
  'лип', 'сер', 'вер', 'жов', 'лис', 'гру',
];
const WEEKDAY_LABELS = ['Пн', '', 'Ср', '', 'Пт', '', 'Нд'];

// Monday-start week index (0 = Monday … 6 = Sunday).
const mondayIndex = (d) => (d.getDay() + 6) % 7;

function buildWeeks(year, balanceByDate) {
  const jan1 = new Date(year, 0, 1);
  const dec31 = new Date(year, 11, 31);
  const start = new Date(jan1);
  start.setDate(start.getDate() - mondayIndex(start)); // back to the Monday on/before Jan 1

  const weeks = [];
  const cur = new Date(start);
  while (cur <= dec31) {
    const week = [];
    for (let i = 0; i < 7; i++) {
      const ds = toDateStr(cur);
      week.push({
        date: ds,
        inYear: cur.getFullYear() === year,
        day: cur.getDate(),
        month: cur.getMonth(),
        balance: balanceByDate.has(ds) ? balanceByDate.get(ds) : null,
      });
      cur.setDate(cur.getDate() + 1);
    }
    weeks.push(week);
  }
  return weeks;
}

// Balance -> cell colour: green for positive, red for negative, neutral when no record.
function cellColor(balance, maxAbs) {
  if (balance === null) return 'var(--surface-2)';
  // A logged-but-zero-balance day still happened — show min-intensity green so it
  // reads as "recorded", distinct from the neutral grey of an unlogged day.
  if (balance === 0) return 'rgba(0, 200, 150, 0.25)';
  const intensity = 0.25 + 0.75 * Math.min(1, Math.abs(balance) / (maxAbs || 1));
  return balance > 0
    ? `rgba(0, 200, 150, ${intensity.toFixed(2)})`
    : `rgba(255, 77, 77, ${intensity.toFixed(2)})`;
}

export default function CalendarHeatmap() {
  const navigate = useNavigate();
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(currentYear);
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [hover, setHover] = useState(null); // { date, balance, x, y }

  useEffect(() => {
    let active = true;
    setLoading(true);
    getCalendar(year)
      .then((d) => active && setData(Array.isArray(d) ? d : []))
      .catch(() => active && setData([]))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [year]);

  const { weeks, maxAbs, hasData } = useMemo(() => {
    const map = new Map(data.map((d) => [d.date, d.balance]));
    const max = data.reduce((m, d) => Math.max(m, Math.abs(d.balance)), 0);
    return { weeks: buildWeeks(year, map), maxAbs: max, hasData: data.length > 0 };
  }, [data, year]);

  // One label per month, placed on the week column that CONTAINS the 1st of that
  // month (per spec). day===1 matches exactly one week per month, so labels are
  // unique by construction — no duplicate "січ січ" — and each lines up 1:1 with
  // its week column in the grid below.
  const monthLabels = useMemo(() => {
    const seen = new Set();
    return weeks.map((w) => {
      const firstOfMonth = w.find((d) => d.inYear && d.day === 1);
      if (firstOfMonth && !seen.has(firstOfMonth.month)) {
        seen.add(firstOfMonth.month);
        return MONTHS_SHORT[firstOfMonth.month];
      }
      return '';
    });
  }, [weeks]);

  // Flatten week-by-week (Mon→Sun) so a single column-flow grid renders them.
  const cells = useMemo(() => weeks.flat(), [weeks]);

  return (
    <section className="card calendar-card">
      <div className="calendar-head">
        <h2 className="card-title" style={{ marginBottom: 0 }}>Календар балансу</h2>
        <div className="calendar-year-nav">
          <button className="btn btn-ghost btn-sm" onClick={() => setYear((y) => y - 1)}>‹</button>
          <span className="calendar-year">{year}</span>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => setYear((y) => y + 1)}
            disabled={year >= currentYear}
          >›</button>
        </div>
      </div>

      {loading ? (
        <div className="stats-placeholder small">Завантаження…</div>
      ) : !hasData ? (
        <div className="stats-placeholder small">Немає записів за {year} рік 📅</div>
      ) : (
        <div className="calendar-scroll">
          <div className="calendar-grid-wrap">
            <div className="calendar-corner" />
            <div className="calendar-months">
              {monthLabels.map((label, i) => (
                <span key={i} className="calendar-month-label">{label}</span>
              ))}
            </div>
            <div className="calendar-weekdays">
              {WEEKDAY_LABELS.map((l, i) => (
                <span key={i} className="calendar-weekday">{l}</span>
              ))}
            </div>
            <div className="calendar-cells">
              {cells.map((cell) => (
                <div
                  key={cell.date}
                  className={`calendar-cell ${cell.inYear ? '' : 'calendar-cell-out'} ${
                    cell.balance !== null ? 'calendar-cell-has' : ''
                  }`}
                  style={{ background: cell.inYear ? cellColor(cell.balance, maxAbs) : 'transparent' }}
                  onMouseEnter={(e) =>
                    cell.inYear && cell.balance !== null &&
                    setHover({ date: cell.date, balance: cell.balance, x: e.clientX, y: e.clientY })
                  }
                  onMouseLeave={() => setHover(null)}
                  onClick={() => cell.balance !== null && navigate(`/day/${cell.date}`)}
                />
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="calendar-legend">
        <span>Менше</span>
        <span className="calendar-legend-swatch" style={{ background: 'rgba(255,77,77,0.85)' }} />
        <span className="calendar-legend-swatch" style={{ background: 'rgba(255,77,77,0.35)' }} />
        <span className="calendar-legend-swatch" style={{ background: 'var(--surface-2)' }} />
        <span className="calendar-legend-swatch" style={{ background: 'rgba(0,200,150,0.35)' }} />
        <span className="calendar-legend-swatch" style={{ background: 'rgba(0,200,150,0.85)' }} />
        <span>Більше</span>
      </div>

      {hover && (
        <div
          className="calendar-tooltip"
          style={{ position: 'fixed', left: hover.x, top: hover.y }}
        >
          <div className="calendar-tooltip-date">{formatShortDate(hover.date)}</div>
          <div className={`calendar-tooltip-bal ${hover.balance >= 0 ? 'positive' : 'negative'}`}>
            {hover.balance >= 0 ? '+' : ''}{formatUAH(hover.balance)}
          </div>
        </div>
      )}
    </section>
  );
}
