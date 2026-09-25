import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  getDay,
  closeDay,
  getCategories,
  addTransaction,
  deleteTransaction,
  undoLastQuickAdd,
  apiError,
} from '../api.js';
import { todayStr, formatLongDate, isValidDateStr } from '../utils/dates.js';
import { formatUAH, formatBalance, formatEntryAmount, formatTime, textLength } from '../utils/format.js';
import { groupByKind, categoryLabel } from '../utils/categories.js';
import useToast from '../utils/useToast.js';
import { CATEGORY_KINDS, KIND_LABELS, NOTE_MAX } from '../constants.js';

const EMPTY_FORM = { categoryId: '', amount: '', note: '' };
const ZERO_TOTALS = { income: 0, expenses: 0, balance: 0 };

// /day and /day/:date render the same component, and React Router would keep its
// state when navigating between them — keying by date gives each day a fresh page.
export default function DayPage() {
  const { date: dateParam } = useParams();
  return <DayLedger key={dateParam || 'today'} dateParam={dateParam} />;
}

function DayLedger({ dateParam }) {
  const navigate = useNavigate();

  // A :date in the path means we opened a day from statistics → read-only by default.
  const viewingPastDay = Boolean(dateParam);
  // Frozen at mount: a page left open past midnight keeps showing the day it opened.
  const [date] = useState(() => dateParam || todayStr());
  const validDate = isValidDateStr(date);
  const isToday = date === todayStr();

  const [day, setDay] = useState(null); // DaySummary, or null while the day has no row
  const [entries, setEntries] = useState([]); // Transaction[], oldest first
  const [categories, setCategories] = useState([]); // active only — the picker
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [categoriesError, setCategoriesError] = useState('');
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [formError, setFormError] = useState('');
  const [actionError, setActionError] = useState('');
  const [busy, setBusy] = useState(false); // a write is in flight
  const [toast, showToast] = useToast();
  const amountRef = useRef(null);

  // Every day fetch takes a ticket; a write bumps it too, so a slower reload that
  // started before the write can never overwrite the fresher write response.
  const loadSeq = useRef(0);

  const readOnly = viewingPastDay && !editing;
  const grouped = useMemo(() => groupByKind(categories), [categories]);
  const selectedCategory = categories.find((c) => String(c.id) === form.categoryId) || null;
  const totals = day || ZERO_TOTALS; // income/expenses/balance summed by the server
  const lastQuickAdd = useMemo(
    () => [...entries].reverse().find((t) => t.source === 'quick_add') || null,
    [entries]
  );
  const canUndo = isToday && !readOnly && Boolean(lastQuickAdd);

  const loadDay = useCallback(async () => {
    const seq = ++loadSeq.current;
    try {
      const { transactions = [], ...summary } = await getDay(date);
      if (seq !== loadSeq.current) return;
      setDay(summary);
      setEntries(transactions);
      setLoadError('');
    } catch (err) {
      if (seq !== loadSeq.current) return;
      if (err.response?.status === 404) {
        // No day row yet = nothing recorded for this date: an empty ledger, not an error.
        setDay(null);
        setEntries([]);
        setLoadError('');
      } else {
        setLoadError(apiError(err, 'Не вдалося завантажити день'));
      }
    }
  }, [date]);

  const loadCategories = useCallback(async () => {
    try {
      const list = await getCategories();
      setCategories(list);
      setCategoriesError('');
      // Drop a selection that is no longer active (archived in Settings meanwhile).
      setForm((f) =>
        f.categoryId && !list.some((c) => String(c.id) === f.categoryId) ? { ...f, categoryId: '' } : f
      );
    } catch (err) {
      setCategoriesError(apiError(err, 'Не вдалося завантажити категорії'));
    }
  }, []);

  useEffect(() => {
    if (!validDate) {
      setLoading(false);
      return undefined;
    }
    let active = true;
    Promise.all([loadDay(), loadCategories()]).finally(() => active && setLoading(false));
    return () => {
      active = false;
      loadSeq.current++; // ignore responses that arrive after unmount
    };
  }, [validDate, loadDay, loadCategories]);

  // Quick-add entries arrive from the phone while this page may be open in
  // another tab/app: refresh the ledger whenever the page becomes visible again.
  useEffect(() => {
    if (!validDate) return undefined;
    const onVisible = () => {
      if (document.visibilityState === 'visible') loadDay();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [validDate, loadDay]);

  const updateForm = (patch) => {
    setForm((f) => ({ ...f, ...patch }));
    if (formError) setFormError('');
  };

  const handleAdd = async (e) => {
    e.preventDefault();
    if (busy || readOnly) return;
    // "1 000,50" → "1000,50": the server accepts a decimal comma but not spaces.
    const amount = form.amount.replace(/\s/g, '');
    const note = form.note.trim();
    if (!form.categoryId) return setFormError('Оберіть категорію');
    if (!amount) return setFormError('Сума має бути додатнім числом');
    if (textLength(note) > NOTE_MAX) return setFormError(`Нотатка — до ${NOTE_MAX} символів`);

    setBusy(true);
    setFormError('');
    setActionError('');
    try {
      const { transaction, day: summary } = await addTransaction({
        category_id: Number(form.categoryId),
        amount,
        date, // explicit, so the entry lands on the day this page shows
        note: note || undefined,
      });
      loadSeq.current++;
      // Filter first: a visibility reload may already have fetched this entry.
      setEntries((list) => [...list.filter((t) => t.id !== transaction.id), transaction]);
      setDay(summary);
      // Keep the category selected — several entries in a row are usually the same kind.
      setForm((f) => ({ ...f, amount: '', note: '' }));
      showToast('Запис додано ✓');
      amountRef.current?.focus();
    } catch (err) {
      setFormError(apiError(err, 'Не вдалося додати запис'));
      // "Категорію архівовано" / "не знайдено": the picker is stale, refresh it.
      const status = err.response?.status;
      if (status === 400 || status === 404) loadCategories();
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (entry) => {
    if (busy) return;
    const label = `${categoryLabel(entry.category)} — ${formatUAH(entry.amount)}`;
    if (!window.confirm(`Видалити запис «${label}»?`)) return;
    setBusy(true);
    setActionError('');
    try {
      const { day: summary } = await deleteTransaction(entry.id);
      loadSeq.current++;
      setEntries((list) => list.filter((t) => t.id !== entry.id));
      setDay(summary); // null when the emptied open day was removed
      showToast('Запис видалено');
    } catch (err) {
      setActionError(apiError(err, 'Не вдалося видалити запис'));
      // Already gone (e.g. undone from the phone) — resync the list.
      if (err.response?.status === 404) loadDay();
    } finally {
      setBusy(false);
    }
  };

  const handleUndo = async () => {
    if (busy || !lastQuickAdd) return;
    const label = `${categoryLabel(lastQuickAdd.category)} — ${formatUAH(lastQuickAdd.amount)}`;
    if (!window.confirm(`Скасувати останній швидкий запис («${label}»)?`)) return;
    setBusy(true);
    setActionError('');
    try {
      const { removed } = await undoLastQuickAdd();
      showToast(`Скасовано: ${categoryLabel(removed.category)} — ${formatUAH(removed.amount)}`);
    } catch (err) {
      setActionError(apiError(err, 'Не вдалося скасувати запис'));
    } finally {
      // The server picks the entry (it may be one this page has not seen yet) and
      // may drop the emptied day, so reload rather than patching the list locally.
      await loadDay();
      setBusy(false);
    }
  };

  const handleClose = async () => {
    if (busy) return;
    setBusy(true);
    setActionError('');
    try {
      const summary = await closeDay(date);
      if (!viewingPastDay) {
        navigate('/');
        return;
      }
      loadSeq.current++;
      setDay(summary);
      setEditing(false);
      showToast('День завершено ✓');
    } catch (err) {
      setActionError(apiError(err, 'Не вдалося завершити день'));
    }
    setBusy(false);
  };

  const handleBack = () => {
    // Entries are saved one by one; only a half-typed entry can be lost.
    const unsent = form.amount.trim() || form.note.trim();
    if (unsent && !window.confirm('Незбережений запис буде втрачено. Вийти?')) return;
    navigate('/');
  };

  if (loading) {
    return (
      <div className="page">
        <div className="day-loading">Завантаження…</div>
      </div>
    );
  }

  if (!validDate) {
    return (
      <div className="page">
        <div className="day-inner fade-in-up">
          <div className="alert-error" role="alert">
            Невірний формат дати (очікується YYYY-MM-DD)
          </div>
          <div className="day-actions">
            <button className="btn btn-ghost" onClick={() => navigate('/')}>
              ← На головну
            </button>
          </div>
        </div>
      </div>
    );
  }

  const isClosed = day?.is_closed === 1;
  const amountLabel =
    selectedCategory?.kind === 'income'
      ? 'Сума доходу'
      : selectedCategory?.kind === 'expense'
        ? 'Сума витрати'
        : 'Сума';
  const noteLength = textLength(form.note);

  return (
    <div className="page">
      <div className="day-inner fade-in-up">
        <header className="day-header">
          <h1>{formatLongDate(date)}</h1>
          <p className="day-subtitle">
            {viewingPastDay ? 'Облік фінансів за день' : 'Облік фінансів за сьогодні'}
          </p>
        </header>

        {readOnly && (
          <div className="readonly-banner">{isClosed ? '🔒 Перегляд: день завершено' : '🔒 Перегляд'}</div>
        )}
        {viewingPastDay && editing && (
          <div className="edit-banner">
            ✏️ Режим редагування: зміни зберігаються одразу
            {isClosed && '. Новий запис знову відкриє день'}
          </div>
        )}
        {!viewingPastDay && isClosed && (
          <div className="info-banner">✅ День завершено. Новий запис знову відкриє його.</div>
        )}

        {loadError && (
          <div className="alert-error" role="alert">
            {loadError}{' '}
            <button className="btn btn-ghost btn-sm" onClick={loadDay}>
              Спробувати ще раз
            </button>
          </div>
        )}

        {/* ---- New entry ---- */}
        {!readOnly && (
          <form className="card entry-form" onSubmit={handleAdd} noValidate>
            <h2 className="card-title">Новий запис</h2>
            {categoriesError && (
              <div className="login-error" role="alert">
                {categoriesError}
              </div>
            )}
            <div className="entry-form-grid">
              <label className="field entry-field-category">
                <span className="field-label">Категорія</span>
                <div className="select-wrap">
                  <select
                    value={form.categoryId}
                    onChange={(e) => updateForm({ categoryId: e.target.value })}
                    disabled={busy}
                  >
                    <option value="" disabled>
                      Оберіть категорію
                    </option>
                    {CATEGORY_KINDS.map(
                      (kind) =>
                        grouped[kind].length > 0 && (
                          <optgroup key={kind} label={KIND_LABELS[kind]}>
                            {grouped[kind].map((c) => (
                              <option key={c.id} value={String(c.id)}>
                                {c.name}
                              </option>
                            ))}
                          </optgroup>
                        )
                    )}
                  </select>
                  {selectedCategory && (
                    <span
                      className="dot select-dot"
                      style={{ background: selectedCategory.color }}
                      aria-hidden="true"
                    />
                  )}
                </div>
              </label>

              <label className="field entry-field-amount">
                <span className="field-label">{amountLabel}</span>
                <div className="input-wrap">
                  <input
                    ref={amountRef}
                    type="text"
                    inputMode="decimal"
                    autoComplete="off"
                    placeholder="0,00"
                    value={form.amount}
                    onChange={(e) => updateForm({ amount: e.target.value })}
                  />
                  <span className="currency">₴</span>
                </div>
              </label>

              <label className="field entry-field-note">
                <span className="field-label">
                  Нотатка <span className="field-optional">(необов’язково)</span>
                </span>
                <div className="input-wrap no-suffix">
                  <input
                    type="text"
                    autoComplete="off"
                    placeholder="напр. кава з колегами"
                    // Loose UTF-16 cap; the exact 200-code-point check runs on submit.
                    maxLength={NOTE_MAX * 2}
                    value={form.note}
                    onChange={(e) => updateForm({ note: e.target.value })}
                  />
                </div>
                {noteLength > NOTE_MAX * 0.8 && (
                  <span className={`field-hint ${noteLength > NOTE_MAX ? 'negative' : ''}`}>
                    {noteLength}/{NOTE_MAX}
                  </span>
                )}
              </label>
            </div>

            {formError && (
              <div className="login-error" role="alert">
                {formError}
              </div>
            )}

            <button
              type="submit"
              className="btn btn-primary"
              disabled={busy || categories.length === 0}
            >
              ➕ Додати запис
            </button>
          </form>
        )}

        {/* ---- Live summary (DaySummary from the server) ---- */}
        <section className="card summary-card" aria-live="polite">
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
              {formatBalance(totals.balance)}
            </span>
          </div>
        </section>

        {/* ---- Entries ---- */}
        <section className="card entries-card">
          <div className="section-head">
            <h2 className="card-title section-title">
              Записи {entries.length > 0 && <span className="counter">{entries.length}</span>}
            </h2>
            {canUndo && (
              <button className="btn btn-warning btn-sm" onClick={handleUndo} disabled={busy}>
                ↩️ Скасувати швидкий запис
              </button>
            )}
          </div>

          {actionError && (
            <div className="login-error" role="alert">
              {actionError}
            </div>
          )}

          {entries.length === 0 ? (
            <div className="entries-empty">
              {readOnly ? 'За цей день немає записів' : 'Записів ще немає — додайте перший вище'}
            </div>
          ) : (
            <ul className="entry-list">
              {entries.map((t) => (
                <li key={t.id} className="entry">
                  <span className="dot" style={{ background: t.category.color }} aria-hidden="true" />
                  <div className="entry-main">
                    <div className="entry-title">
                      <span className="entry-cat">{t.category.name}</span>
                      {t.category.archived && <span className="badge badge-archived">архів</span>}
                      {t.source === 'quick_add' && (
                        <span className="badge badge-quick" title="Додано через швидке додавання (Apple Shortcuts)">
                          ⚡ швидкий
                        </span>
                      )}
                    </div>
                    {t.note && <div className="entry-note">{t.note}</div>}
                    <div className="entry-meta">{formatTime(t.created_at)}</div>
                  </div>
                  <span className={`entry-amount ${t.category.kind}`}>
                    {formatEntryAmount(t.amount, t.category.kind)}
                  </span>
                  {!readOnly && (
                    <button
                      className="icon-btn icon-btn-danger"
                      aria-label={`Видалити запис ${t.category.name}, ${formatUAH(t.amount)}`}
                      title="Видалити"
                      onClick={() => handleDelete(t)}
                      disabled={busy}
                    >
                      ✕
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* ---- Actions ---- */}
        {viewingPastDay ? (
          editing ? (
            <div className="day-actions">
              <button className="btn btn-ghost" onClick={() => setEditing(false)}>
                Готово
              </button>
              {day && !isClosed && (
                <button className="btn btn-danger" onClick={handleClose} disabled={busy}>
                  Завершити день
                </button>
              )}
            </div>
          ) : (
            <div className="day-actions">
              <button className="btn btn-ghost" onClick={() => navigate('/stats')}>
                ← Назад до статистики
              </button>
              <button className="btn btn-warning" onClick={() => setEditing(true)}>
                ✏️ Редагувати
              </button>
            </div>
          )
        ) : (
          <div className="day-actions">
            <button className="btn btn-ghost" onClick={handleBack}>
              ← Назад
            </button>
            {!isClosed && (
              <button className="btn btn-danger" onClick={handleClose} disabled={busy}>
                Завершити день
              </button>
            )}
          </div>
        )}
      </div>

      <div className={`toast ${toast.visible ? 'toast-show' : ''}`} role="status" aria-live="polite">
        {toast.text}
      </div>
    </div>
  );
}
