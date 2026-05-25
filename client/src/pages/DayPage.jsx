import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { getDay, saveDay, closeDay } from '../api.js';
import { todayStr, formatLongDate } from '../utils/dates.js';
import { formatUAH, toAmount } from '../utils/format.js';
import { INCOME_FIELDS, EXPENSE_FIELDS } from '../constants.js';

const AMOUNT_KEYS = [...INCOME_FIELDS, ...EXPENSE_FIELDS].map((f) => f.key);

const EMPTY_FORM = Object.fromEntries(AMOUNT_KEYS.map((k) => [k, '']));

export default function DayPage() {
  const navigate = useNavigate();
  const { date: dateParam } = useParams();
  const [searchParams] = useSearchParams();
  const fresh = searchParams.get('fresh') === '1';

  // A :date in the path means we opened a past day from statistics → read-only.
  const readOnly = Boolean(dateParam);
  const date = dateParam || todayStr();

  const [form, setForm] = useState(EMPTY_FORM);
  const [isClosed, setIsClosed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(false);

  useEffect(() => {
    let active = true;
    if (fresh && !dateParam) {
      setForm(EMPTY_FORM);
      setIsClosed(false);
      setLoading(false);
      return;
    }
    getDay(date)
      .then((row) => {
        if (!active) return;
        const next = { ...EMPTY_FORM };
        for (const key of AMOUNT_KEYS) next[key] = row[key] ? String(row[key]) : '';
        setForm(next);
        setIsClosed(row.is_closed === 1);
      })
      .catch(() => {
        if (active) setForm(EMPTY_FORM);
      })
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [date, fresh, dateParam]);

  const handleChange = (key, raw) => {
    if (readOnly) return;
    if (raw === '') return setForm((f) => ({ ...f, [key]: '' }));
    let n = Number(raw);
    if (!Number.isFinite(n) || n < 0) return; // reject negatives / junk silently
    setForm((f) => ({ ...f, [key]: raw }));
  };

  const totals = useMemo(() => {
    const income = INCOME_FIELDS.reduce((s, f) => s + toAmount(form[f.key]), 0);
    const expenses = EXPENSE_FIELDS.reduce((s, f) => s + toAmount(form[f.key]), 0);
    return { income, expenses, balance: income - expenses };
  }, [form]);

  const buildPayload = (closedFlag) => {
    const payload = { date, is_closed: closedFlag ? 1 : 0 };
    for (const key of AMOUNT_KEYS) payload[key] = toAmount(form[key]);
    return payload;
  };

  const handleSave = async () => {
    await saveDay(date, buildPayload(false));
    setToast(true);
    window.clearTimeout(handleSave._t);
    handleSave._t = window.setTimeout(() => setToast(false), 3000);
  };

  const handleFinish = async () => {
    await saveDay(date, buildPayload(false));
    await closeDay(date);
    navigate('/');
  };

  const handleBack = () => {
    if (window.confirm('Ви впевнені?')) navigate('/');
  };

  if (loading) {
    return (
      <div className="page">
        <div className="day-loading">Завантаження…</div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="day-inner fade-in-up">
        <header className="day-header">
          <h1>{formatLongDate(date)}</h1>
          <p className="day-subtitle">
            {readOnly ? 'Облік фінансів за день' : 'Облік фінансів за сьогодні'}
          </p>
        </header>

        {readOnly && <div className="readonly-banner">🔒 Перегляд: день завершено</div>}

        {/* ---- Доходи ---- */}
        <section className="card">
          <h2 className="card-title">Доходи</h2>
          <div className="income-row">
            {INCOME_FIELDS.map((field) => (
              <label key={field.key} className="field">
                <span className="field-label">{field.label}</span>
                <div className="input-wrap">
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    inputMode="decimal"
                    placeholder={field.placeholder}
                    value={form[field.key]}
                    disabled={readOnly}
                    onChange={(e) => handleChange(field.key, e.target.value)}
                  />
                  <span className="currency">₴</span>
                </div>
              </label>
            ))}
          </div>
        </section>

        {/* ---- Витрати ---- */}
        <section className="card">
          <h2 className="card-title">Витрати</h2>
          <div className="expense-list">
            {EXPENSE_FIELDS.map((field) => (
              <label key={field.key} className="expense-row">
                <span className="expense-icon" aria-hidden="true">
                  {field.icon}
                </span>
                <span className="expense-label">{field.label}</span>
                <div className="input-wrap expense-input">
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    inputMode="decimal"
                    placeholder={field.placeholder}
                    value={form[field.key]}
                    disabled={readOnly}
                    onChange={(e) => handleChange(field.key, e.target.value)}
                  />
                  <span className="currency">₴</span>
                </div>
              </label>
            ))}
          </div>
        </section>

        {/* ---- Live summary ---- */}
        <section className="card summary-card">
          <div className="summary-line">
            <span>Загальний дохід</span>
            <span className="summary-value income">{formatUAH(totals.income)}</span>
          </div>
          <div className="summary-line">
            <span>Загальні витрати</span>
            <span className="summary-value expense">{formatUAH(totals.expenses)}</span>
          </div>
          <div className="summary-line summary-balance">
            <span>Баланс</span>
            <span className={`summary-value ${totals.balance >= 0 ? 'positive' : 'negative'}`}>
              {totals.balance >= 0 ? '+' : ''}
              {formatUAH(totals.balance)}
            </span>
          </div>
        </section>

        {/* ---- Actions ---- */}
        {readOnly ? (
          <div className="day-actions">
            <button className="btn btn-ghost" onClick={() => navigate('/stats')}>
              ← Назад до статистики
            </button>
          </div>
        ) : (
          <div className="day-actions">
            <button className="btn btn-ghost" onClick={handleBack}>
              ← Назад
            </button>
            <button className="btn btn-danger" onClick={handleFinish}>
              Завершити день
            </button>
            <button className="btn btn-primary" onClick={handleSave}>
              Зберегти
            </button>
          </div>
        )}
      </div>

      <div className={`toast ${toast ? 'toast-show' : ''}`}>Збережено ✓</div>
    </div>
  );
}
