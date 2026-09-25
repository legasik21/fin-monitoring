import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { register, setToken, getToken, apiError } from '../api.js';
import {
  CATEGORY_KINDS,
  CATEGORY_LIMITS,
  CATEGORY_NAME_MAX,
  DEFAULT_CATEGORY_NAMES,
  PASSWORD_MAX,
  PASSWORD_MIN,
} from '../constants.js';
import { textLength } from '../utils/format.js';

// Same shape check as the server; it only saves a round trip for obvious typos.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const KIND_TITLES = { income: 'Категорії доходу', expense: 'Категорії витрат' };
const ADD_LABELS = { income: '➕ Додати категорію доходу', expense: '➕ Додати категорію витрат' };
const PLACEHOLDERS = { income: 'напр. ЗП – обменка', expense: 'напр. Їжа' };

/**
 * Client mirror of resolveRegistrationCategories: blank rows are dropped, names
 * are trimmed, duplicates within a kind are rejected. The server re-validates.
 * Returns { value } or { error }.
 */
function collectCategories(rows) {
  const value = {};
  for (const kind of CATEGORY_KINDS) {
    const names = [];
    const seen = new Set();
    for (const row of rows[kind]) {
      const name = row.name.trim();
      if (!name) continue;
      if (textLength(name) > CATEGORY_NAME_MAX) {
        return { error: `Назва категорії — до ${CATEGORY_NAME_MAX} символів` };
      }
      const key = name.toLocaleLowerCase('uk-UA');
      if (seen.has(key)) return { error: `Категорія «${name}» вказана двічі` };
      seen.add(key);
      names.push(name);
    }
    value[kind] = names;
  }
  return { value };
}

export default function RegisterPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  // Optional custom categories: { income: [{ id, name }], expense: [...] }.
  const [rows, setRows] = useState({ income: [], expense: [] });
  const [focusId, setFocusId] = useState(null);
  const nextId = useRef(1);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (getToken()) navigate('/', { replace: true });
  }, [navigate]);

  const clearError = () => error && setError('');

  const addRow = (kind) => {
    if (rows[kind].length >= CATEGORY_LIMITS[kind]) return;
    const id = nextId.current++;
    setRows((r) => ({ ...r, [kind]: [...r[kind], { id, name: '' }] }));
    setFocusId(id); // the new input autofocuses on mount
    clearError();
  };

  const updateRow = (kind, id, name) => {
    setRows((r) => ({ ...r, [kind]: r[kind].map((row) => (row.id === id ? { ...row, name } : row)) }));
    clearError();
  };

  const removeRow = (kind, id) => {
    setRows((r) => ({ ...r, [kind]: r[kind].filter((row) => row.id !== id) }));
    clearError();
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (submitting) return;

    const trimmedEmail = email.trim();
    if (!EMAIL_RE.test(trimmedEmail)) return setError('Невірний формат email');
    // Code points, like the server (an emoji counts as one character).
    if (textLength(password) < PASSWORD_MIN) {
      return setError(`Пароль має містити щонайменше ${PASSWORD_MIN} символів`);
    }
    if (textLength(password) > PASSWORD_MAX) return setError('Пароль занадто довгий');
    // Confirmation is a client-only typo guard; the server never sees it.
    if (password !== confirm) return setError('Паролі не збігаються');
    const { value: categories, error: catError } = collectCategories(rows);
    if (catError) return setError(catError);

    setSubmitting(true);
    setError('');
    try {
      const { token } = await register(trimmedEmail, password, categories);
      setToken(token);
      navigate('/', { replace: true });
    } catch (err) {
      setError(apiError(err, 'Не вдалося зареєструватися'));
      setSubmitting(false);
    }
  };

  return (
    <div className="page login">
      <form className="card login-card auth-card register-card fade-in-up" onSubmit={handleSubmit} noValidate>
        <h1 className="login-title">💰 Фінансовий щоденник</h1>
        <p className="auth-subtitle">Створення акаунта</p>

        <label className="field">
          <span className="field-label">Email</span>
          <div className="input-wrap no-suffix">
            <input
              type="email"
              name="email"
              autoComplete="email"
              inputMode="email"
              placeholder="you@example.com"
              value={email}
              autoFocus
              onChange={(e) => {
                setEmail(e.target.value);
                clearError();
              }}
            />
          </div>
        </label>

        <label className="field">
          <span className="field-label">Пароль</span>
          <div className="input-wrap no-suffix">
            <input
              type="password"
              name="new-password"
              autoComplete="new-password"
              placeholder="Щонайменше 8 символів"
              aria-describedby="password-hint"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                clearError();
              }}
            />
          </div>
          <span className="field-hint" id="password-hint">
            Мінімум {PASSWORD_MIN} символів. Відновлення пароля немає — запам’ятайте його.
          </span>
        </label>

        <label className="field">
          <span className="field-label">Повторіть пароль</span>
          <div className="input-wrap no-suffix">
            <input
              type="password"
              name="confirm-password"
              autoComplete="new-password"
              placeholder="Ще раз той самий пароль"
              value={confirm}
              onChange={(e) => {
                setConfirm(e.target.value);
                clearError();
              }}
            />
          </div>
        </label>

        <fieldset className="reg-categories">
          <legend className="reg-legend">Категорії (необов’язково)</legend>
          <p className="field-hint">
            Додайте власні категорії зараз або пізніше в налаштуваннях. Якщо тип залишити
            порожнім, буде створено «{DEFAULT_CATEGORY_NAMES.income}» / «{DEFAULT_CATEGORY_NAMES.expense}».
          </p>

          {CATEGORY_KINDS.map((kind) => {
            const list = rows[kind];
            const atLimit = list.length >= CATEGORY_LIMITS[kind];
            return (
              <div className="reg-kind" key={kind}>
                <div className="section-head">
                  <span className="reg-kind-title">{KIND_TITLES[kind]}</span>
                  <span className={`counter ${atLimit ? 'counter-full' : ''}`}>
                    {list.length}/{CATEGORY_LIMITS[kind]}
                  </span>
                </div>

                {list.length === 0 && (
                  <div className="reg-default">
                    За замовчуванням: «{DEFAULT_CATEGORY_NAMES[kind]}»
                  </div>
                )}

                {list.map((row, i) => (
                  <div className="reg-cat-row" key={row.id}>
                    <div className="input-wrap no-suffix">
                      <input
                        type="text"
                        aria-label={`${KIND_TITLES[kind]}: назва ${i + 1}`}
                        placeholder={PLACEHOLDERS[kind]}
                        // maxLength counts UTF-16 units (an emoji = 2), so it is only a
                        // loose cap; the exact 50-code-point check runs on submit.
                        maxLength={CATEGORY_NAME_MAX * 2}
                        value={row.name}
                        autoFocus={row.id === focusId}
                        onChange={(e) => updateRow(kind, row.id, e.target.value)}
                        // Enter inside a category name should not submit the whole
                        // registration half-filled.
                        onKeyDown={(e) => e.key === 'Enter' && e.preventDefault()}
                      />
                    </div>
                    <button
                      type="button"
                      className="icon-btn icon-btn-danger"
                      aria-label={`Прибрати категорію ${row.name.trim() || i + 1}`}
                      onClick={() => removeRow(kind, row.id)}
                    >
                      ✕
                    </button>
                  </div>
                ))}

                <button
                  type="button"
                  className="btn btn-ghost btn-sm reg-add-btn"
                  onClick={() => addRow(kind)}
                  disabled={atLimit}
                >
                  {atLimit ? `Максимум ${CATEGORY_LIMITS[kind]}` : ADD_LABELS[kind]}
                </button>
              </div>
            );
          })}
        </fieldset>

        {error && (
          <div className="login-error" role="alert">
            {error}
          </div>
        )}

        <button type="submit" className="btn btn-primary btn-lg" disabled={submitting}>
          {submitting ? 'Зачекайте…' : 'Зареєструватися'}
        </button>

        <p className="auth-switch">
          Вже є акаунт?{' '}
          <Link className="link" to="/login">
            Увійти
          </Link>
        </p>
      </form>
    </div>
  );
}
