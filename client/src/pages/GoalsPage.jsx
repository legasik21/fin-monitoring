import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getGoals, createGoal, updateGoal, deleteGoal, apiError } from '../api.js';
import { formatUAH, toAmount } from '../utils/format.js';

function GoalCard({ goal, onContribute, onDelete }) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const submit = async () => {
    const value = toAmount(amount);
    if (value <= 0) return;
    setBusy(true);
    setErr('');
    try {
      await onContribute(goal.id, value);
      setAmount('');
      setOpen(false);
    } catch (e) {
      setErr(apiError(e, 'Не вдалося додати внесок'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`card goal-card ${goal.achieved ? 'goal-achieved' : ''}`}>
      <div className="goal-card-head">
        <h3 className="goal-title">
          {goal.achieved && <span className="goal-check" aria-hidden="true">✅</span>}
          {goal.title}
        </h3>
        <button
          className="goal-del"
          title="Видалити"
          aria-label={`Видалити ціль «${goal.title}»`}
          onClick={() => onDelete(goal)}
        >
          ✕
        </button>
      </div>

      <div className="goal-progress">
        <div
          className={`goal-progress-fill ${goal.achieved ? 'done' : ''}`}
          style={{ width: `${goal.percent}%` }}
        />
        {goal.achieved && <div className="goal-sparkle" aria-hidden="true">✨</div>}
      </div>

      <div className="goal-meta">
        <span className="goal-amounts">
          {formatUAH(goal.current_amount)} з {formatUAH(goal.target_amount)}
        </span>
        <span className={`goal-percent ${goal.achieved ? 'positive' : ''}`}>{goal.percent}%</span>
      </div>

      {goal.achieved ? (
        <div className="goal-done-banner">🎉 Ціль досягнуто!</div>
      ) : open ? (
        <div className="goal-contribute">
          <div className="input-wrap">
            <input
              type="number"
              min="0"
              step="0.01"
              inputMode="decimal"
              placeholder="Сума внеску"
              aria-label={`Сума внеску для «${goal.title}»`}
              value={amount}
              autoFocus
              onChange={(e) => setAmount(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && submit()}
            />
            <span className="currency">₴</span>
          </div>
          <button className="btn btn-primary btn-sm" onClick={submit} disabled={busy}>
            {busy ? '…' : 'Додати'}
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => { setErr(''); setOpen(false); }}>Скасувати</button>
          {err && <div className="login-error goal-contribute-error">{err}</div>}
        </div>
      ) : (
        <button className="btn btn-secondary btn-sm goal-add-btn" onClick={() => setOpen(true)}>
          ➕ Додати внесок
        </button>
      )}
    </div>
  );
}

export default function GoalsPage() {
  const navigate = useNavigate();
  const [goals, setGoals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState('');
  const [target, setTarget] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  // A failed load is its own state: rendering it as an empty list would tell the
  // user their goals are gone.
  const [loadError, setLoadError] = useState('');
  const mountedRef = useRef(true);
  // Only the newest load may write state: a late response from an older one (a
  // retry racing a post-mutation refresh) must not overwrite fresher data.
  const requestRef = useRef(0);

  const refresh = async () => {
    const request = ++requestRef.current;
    let list = null;
    let failure = '';
    try {
      list = await getGoals();
    } catch (err) {
      failure = apiError(err, 'Не вдалося завантажити цілі');
    }
    // Unmounted mid-fetch, or superseded by a newer load.
    if (!mountedRef.current || request !== requestRef.current) return;
    // On failure keep the goals already on screen (e.g. after a successful
    // contribution whose follow-up reload failed) — the banner says it is stale.
    if (list) setGoals(list);
    setLoadError(failure);
    setLoading(false);
  };

  const retryLoad = () => {
    setLoadError('');
    setLoading(true);
    refresh();
  };

  useEffect(() => {
    mountedRef.current = true;
    refresh();
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const handleCreate = async (e) => {
    e.preventDefault();
    setError('');
    const t = title.trim();
    const amt = toAmount(target);
    if (!t) return setError('Вкажіть назву цілі');
    if (amt <= 0) return setError('Сума має бути більшою за 0');
    setCreating(true);
    try {
      await createGoal({ title: t, target_amount: amt });
      setTitle('');
      setTarget('');
      await refresh();
    } catch (err) {
      setError(apiError(err, 'Не вдалося створити ціль'));
    } finally {
      setCreating(false);
    }
  };

  const handleContribute = async (id, amount) => {
    await updateGoal(id, { contribute: amount });
    await refresh();
  };

  const handleDelete = async (goal) => {
    if (!window.confirm(`Видалити ціль «${goal.title}»?`)) return;
    try {
      await deleteGoal(goal.id);
      await refresh();
    } catch (err) {
      window.alert(apiError(err, 'Не вдалося видалити ціль'));
    }
  };

  return (
    <div className="page">
      <div className="goals-inner fade-in-up">
        <header className="stats-header">
          <button className="btn btn-ghost btn-sm" onClick={() => navigate('/')}>← Назад</button>
          <h1>Цілі</h1>
          <div style={{ width: 64 }} />
        </header>

        <form className="card goal-form" onSubmit={handleCreate}>
          <h2 className="card-title">Створити ціль</h2>
          <label className="field">
            <span className="field-label">Назва</span>
            <div className="input-wrap">
              <input
                type="text"
                placeholder="напр. Накопити на джойстик"
                value={title}
                onChange={(e) => { setTitle(e.target.value); if (error) setError(''); }}
              />
            </div>
          </label>
          <label className="field">
            <span className="field-label">Цільова сума</span>
            <div className="input-wrap">
              <input
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                placeholder="напр. 15000"
                value={target}
                onChange={(e) => { setTarget(e.target.value); if (error) setError(''); }}
              />
              <span className="currency">₴</span>
            </div>
          </label>
          {error && <div className="login-error">{error}</div>}
          <button type="submit" className="btn btn-primary" disabled={creating}>
            {creating ? 'Зачекайте…' : 'Створити'}
          </button>
        </form>

        {loading ? (
          <div className="stats-placeholder">Завантаження…</div>
        ) : (
          <>
            {loadError && (
              <div className="alert-error" role="alert">
                {loadError}{' '}
                <button className="btn btn-ghost btn-sm" onClick={retryLoad}>
                  Спробувати ще раз
                </button>
              </div>
            )}
            {goals.length > 0 ? (
              <div className="goals-list">
                {goals.map((g) => (
                  <GoalCard key={g.id} goal={g} onContribute={handleContribute} onDelete={handleDelete} />
                ))}
              </div>
            ) : (
              // Never claim "no goals" when the load itself failed.
              !loadError && <div className="stats-placeholder">Ще немає цілей. Створіть першу! 🎯</div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
