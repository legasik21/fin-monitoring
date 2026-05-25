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
import { getStats } from '../api.js';
import { formatShortDate } from '../utils/dates.js';
import { formatUAH, formatNumber, toAmount } from '../utils/format.js';

const RANGES = [
  { key: 'day', label: 'День' },
  { key: 'week', label: 'Тиждень' },
  { key: 'month', label: 'Місяць' },
];

const TABLE_COLS = [
  { key: 'income_main', label: 'Дохід' },
  { key: 'income_tips', label: 'Чайові' },
  { key: 'expense_food_out', label: 'Їжа' },
  { key: 'expense_food_market', label: 'Продукти' },
  { key: 'expense_no_reason', label: '«Ні за що»' },
  { key: 'expense_gas', label: 'Пальне' },
];

function rowBalance(r) {
  const income = toAmount(r.income_main) + toAmount(r.income_tips);
  const expenses =
    toAmount(r.expense_food_out) +
    toAmount(r.expense_food_market) +
    toAmount(r.expense_no_reason) +
    toAmount(r.expense_gas);
  return income - expenses;
}

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="chart-tooltip">
      <div className="chart-tooltip-label">{label}</div>
      {payload.map((p) => (
        <div key={p.dataKey} className="chart-tooltip-row">
          <span className="dot" style={{ background: p.color || p.fill }} />
          <span>{p.name}:</span>
          <strong>{formatUAH(p.value)}</strong>
        </div>
      ))}
    </div>
  );
}

export default function StatisticsPage() {
  const navigate = useNavigate();
  const [range, setRange] = useState('day');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    getStats(range)
      .then((d) => active && setData(d))
      .catch(() => active && setData(null))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [range]);

  const pieData = (data?.categories || []).filter((c) => c.value > 0);

  return (
    <div className="page">
      <div className="stats-inner fade-in-up">
        <header className="stats-header">
          <button className="btn btn-ghost btn-sm" onClick={() => navigate('/')}>
            ← Назад
          </button>
          <h1>Статистика</h1>
          <div className="stats-tabs">
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
        </header>

        {loading ? (
          <div className="stats-placeholder">Завантаження…</div>
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
                    <div className="stat-card-value positive">
                      +{formatUAH(data.summary.bestDay.balance)}
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
                          nameKey="label"
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
                          <span className="pie-legend-label">{c.label}</span>
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
                      {TABLE_COLS.map((c) => (
                        <th key={c.key}>{c.label}</th>
                      ))}
                      <th>Баланс</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.days.map((row) => {
                      const bal = rowBalance(row);
                      return (
                        <tr key={row.date} className={bal >= 0 ? 'row-positive' : 'row-negative'}>
                          <td>{formatShortDate(row.date)}</td>
                          {TABLE_COLS.map((c) => (
                            <td key={c.key} className="num">
                              {formatNumber(row[c.key])}
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
      </div>
    </div>
  );
}
