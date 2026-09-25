import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  PieChart,
  Pie,
  Cell,
} from 'recharts';
import { getStats, apiError } from '../api.js';
import { formatShortDate } from '../utils/dates.js';
import { formatUAH, formatNumber, formatBalance } from '../utils/format.js';
import { categoryLabel } from '../utils/categories.js';
import CalendarHeatmap from '../components/CalendarHeatmap.jsx';
import MonthlyReport from '../components/MonthlyReport.jsx';

const VIEWS = [
  { key: 'overview', label: 'Огляд' },
  { key: 'calendar', label: 'Календар' },
  { key: 'monthly', label: 'Місяць' },
];

const RANGES = [
  { key: 'day', label: 'День' },
  { key: 'week', label: 'Тиждень' },
  { key: 'month', label: 'Місяць' },
];

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="chart-tooltip">
      <div className="chart-tooltip-label">{label}</div>
      {payload.map((p) => (
        <div key={p.dataKey ?? p.name} className="chart-tooltip-row">
          <span className="dot" style={{ background: p.color || p.fill || p.payload?.fill }} />
          <span>{p.name}:</span>
          <strong>{formatUAH(p.value)}</strong>
        </div>
      ))}
    </div>
  );
}

export default function StatisticsPage() {
  const navigate = useNavigate();
  const [view, setView] = useState('overview');
  const [range, setRange] = useState('day');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  // A failed request is not "no data for this period" — keep the two apart.
  const [loadError, setLoadError] = useState('');
  const [reloadKey, setReloadKey] = useState(0); // bumped by «Спробувати ще раз»

  useEffect(() => {
    if (view !== 'overview') return undefined;
    let active = true;
    setLoading(true);
    setLoadError('');
    getStats(range)
      .then((d) => active && setData(d))
      .catch((err) => active && setLoadError(apiError(err, 'Не вдалося завантажити статистику')))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [range, view, reloadKey]);

  // Colours and category order come from the server; archived categories stay in
  // the breakdown (they still have entries in the window), just labelled.
  const pieData = (data?.categories || [])
    .filter((c) => c.value > 0)
    .map((c) => ({ ...c, name: categoryLabel(c), fill: c.color }));
  // Per-user table columns (income categories, then expense), keyed by category id.
  const columns = data?.columns || [];

  return (
    <div className="page">
      <div className="stats-inner fade-in-up">
        <header className="stats-header">
          <button className="btn btn-ghost btn-sm" onClick={() => navigate('/')}>
            ← Назад
          </button>
          <h1>Статистика</h1>
          <div className="stats-tabs">
            {VIEWS.map((v) => (
              <button
                key={v.key}
                className={`tab ${view === v.key ? 'tab-active' : ''}`}
                onClick={() => setView(v.key)}
              >
                {v.label}
              </button>
            ))}
          </div>
        </header>

        {view === 'calendar' && <CalendarHeatmap />}
        {view === 'monthly' && <MonthlyReport />}

        {view === 'overview' && (
          <>
            <div className="stats-tabs stats-range-tabs">
              {RANGES.map((r) => (
                <button
                  key={r.key}
                  className={`tab ${range === r.key ? 'tab-active' : ''}`}
                  onClick={() => setRange(r.key)}
                >
                  {r.label}
                </button>
              ))}
            </div>

            {loading ? (
              <div className="stats-placeholder">Завантаження…</div>
            ) : loadError ? (
              <div className="alert-error" role="alert">
                {loadError}{' '}
                <button className="btn btn-ghost btn-sm" onClick={() => setReloadKey((k) => k + 1)}>
                  Спробувати ще раз
                </button>
              </div>
            ) : !data || !data.hasData ? (
              <div className="stats-placeholder">Немає даних за цей період 📊</div>
            ) : (
              <>
            {/* ---- Block 4: summary cards ---- */}
            <section className="stat-cards">
              <div className="stat-card">
                <div className="stat-card-label">Середній дохід</div>
                <div className="stat-card-value income">{formatUAH(data.summary.avgIncome)}</div>
              </div>
              <div className="stat-card">
                <div className="stat-card-label">Середні витрати</div>
                <div className="stat-card-value expense">{formatUAH(data.summary.avgExpenses)}</div>
              </div>
              <div className="stat-card">
                <div className="stat-card-label">Найкращий день</div>
                {data.summary.bestDay ? (
                  <>
                    <div
                      className={`stat-card-value ${
                        data.summary.bestDay.balance >= 0 ? 'positive' : 'negative'
                      }`}
                    >
                      {formatBalance(data.summary.bestDay.balance)}
                    </div>
                    <div className="stat-card-sub">{formatShortDate(data.summary.bestDay.date)}</div>
                  </>
                ) : (
                  <div className="stat-card-value">—</div>
                )}
              </div>
              <div className="stat-card">
                <div className="stat-card-label">Найгірший день</div>
                {data.summary.worstDay ? (
                  <>
                    <div
                      className={`stat-card-value ${
                        data.summary.worstDay.balance >= 0 ? 'positive' : 'negative'
                      }`}
                    >
                      {data.summary.worstDay.balance >= 0 ? '+' : ''}
                      {formatUAH(data.summary.worstDay.balance)}
                    </div>
                    <div className="stat-card-sub">{formatShortDate(data.summary.worstDay.date)}</div>
                  </>
                ) : (
                  <div className="stat-card-value">—</div>
                )}
              </div>
            </section>

            <div className="charts-grid">
              {/* ---- Block 1: income vs expenses ---- */}
              <section className="card chart-card">
                <h2 className="card-title">Порівняння доходів і витрат</h2>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={data.chart} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.07)" />
                    <XAxis dataKey="label" tick={{ fill: '#9aa0b0', fontSize: 12 }} />
                    <YAxis tick={{ fill: '#9aa0b0', fontSize: 12 }} />
                    <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
                    <Legend wrapperStyle={{ color: '#9aa0b0' }} />
                    <Bar dataKey="income" name="Дохід" fill="#4D9EFF" radius={[6, 6, 0, 0]} />
                    <Bar dataKey="expenses" name="Витрати" fill="#FF4D4D" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </section>

              {/* ---- Block 2: expense breakdown ---- */}
              <section className="card chart-card">
                <h2 className="card-title">Розподіл витрат за категоріями</h2>
                {pieData.length === 0 ? (
                  <div className="stats-placeholder small">Витрат за цей період немає</div>
                ) : (
                  <>
                    <ResponsiveContainer width="100%" height={230}>
                      <PieChart>
                        <Pie
                          data={pieData}
                          dataKey="value"
                          nameKey="name"
                          cx="50%"
                          cy="50%"
                          innerRadius={55}
                          outerRadius={90}
                          paddingAngle={2}
                          stroke="none"
                        >
                          {pieData.map((c) => (
                            <Cell key={c.key} fill={c.color} />
                          ))}
                        </Pie>
                        <Tooltip content={<ChartTooltip />} />
                      </PieChart>
                    </ResponsiveContainer>
                    <ul className="pie-legend">
                      {pieData.map((c) => (
                        <li key={c.key}>
                          <span className="dot" style={{ background: c.color }} />
                          <span className="pie-legend-label">{c.name}</span>
                          <span className="pie-legend-percent">{formatNumber(c.percent)}%</span>
                          <span className="pie-legend-amount">{formatUAH(c.value)}</span>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </section>
            </div>

            {/* ---- Block 3: summary table ---- */}
            <section className="card table-card">
              <h2 className="card-title">Деталізація за днями</h2>
              <div className="table-scroll">
                <table className="stats-table">
                  <thead>
                    <tr>
                      <th>Дата</th>
                      {columns.map((c) => (
                        <th key={c.key} className={c.archived ? 'th-archived' : undefined}>
                          <span className="th-cat">
                            <span className="dot" style={{ background: c.color }} aria-hidden="true" />
                            {categoryLabel(c)}
                          </span>
                        </th>
                      ))}
                      <th>Баланс</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.days.map((row) => {
                      // Balance is summed in SQL; a category missing from `amounts` means 0.
                      const bal = row.balance;
                      return (
                        <tr key={row.date} className={bal >= 0 ? 'row-positive' : 'row-negative'}>
                          <td>{formatShortDate(row.date)}</td>
                          {columns.map((c) => (
                            <td key={c.key} className="num">
                              {formatNumber(row.amounts?.[c.key] ?? 0)}
                            </td>
                          ))}
                          <td className={`num strong ${bal >= 0 ? 'positive' : 'negative'}`}>
                            {bal >= 0 ? '+' : ''}
                            {formatNumber(bal)}
                          </td>
                          <td>
                            <button
                              className="btn btn-ghost btn-sm"
                              onClick={() => navigate(`/day/${row.date}`)}
                              aria-label={`Переглянути ${formatShortDate(row.date)}`}
                            >
                              Переглянути
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
