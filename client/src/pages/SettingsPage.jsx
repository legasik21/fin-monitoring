import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  getMe,
  clearToken,
  generateQuickAddKey,
  revokeQuickAddKey,
  getCategories,
  createCategory,
  renameCategory,
  reorderCategories,
  archiveCategory,
  absoluteApiUrl,
  apiError,
} from '../api.js';
import { CATEGORY_KINDS, CATEGORY_LIMITS, CATEGORY_NAME_MAX } from '../constants.js';
import { formatShortDate, toDateStr } from '../utils/dates.js';
import { textLength } from '../utils/format.js';
import useToast from '../utils/useToast.js';

const KIND_TITLES = { income: 'Категорії доходу', expense: 'Категорії витрат' };

/** Client-side name check, same rules and messages as the server; null when OK. */
function nameError(name) {
  if (!name) return 'Вкажіть назву категорії';
  if (textLength(name) > CATEGORY_NAME_MAX) return `Назва категорії — до ${CATEGORY_NAME_MAX} символів`;
  return null;
}

export default function SettingsPage() {
  const navigate = useNavigate();
  const [me, setMe] = useState(null);
  const [categories, setCategories] = useState([]); // active + archived
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [toast, showToast] = useToast();

  const loadCategories = useCallback(async () => {
    const list = await getCategories({ includeArchived: true });
    setCategories(list);
  }, []);

  useEffect(() => {
    let active = true;
    Promise.all([getMe(), getCategories({ includeArchived: true })])
      .then(([user, list]) => {
        if (!active) return;
        setMe(user);
        setCategories(list);
      })
      .catch((err) => active && setLoadError(apiError(err, 'Не вдалося завантажити налаштування')))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, []);

  const byKind = useMemo(() => {
    const out = {};
    for (const kind of CATEGORY_KINDS) {
      const ofKind = categories.filter((c) => c.kind === kind);
      out[kind] = {
        active: ofKind.filter((c) => !c.archived),
        archived: ofKind.filter((c) => c.archived),
      };
    }
    return out;
  }, [categories]);

  const handleLogout = () => {
    clearToken();
    navigate('/login', { replace: true });
  };

  return (
    <div className="page">
      <div className="settings-inner fade-in-up">
        <header className="stats-header">
          <button className="btn btn-ghost btn-sm" onClick={() => navigate('/')}>
            ← Назад
          </button>
          <h1>Налаштування</h1>
        </header>

        {loading ? (
          <div className="stats-placeholder">Завантаження…</div>
        ) : loadError ? (
          <div className="alert-error" role="alert">
            {loadError}
          </div>
        ) : (
          <>
            <section className="card settings-section">
              <h2 className="card-title">Акаунт</h2>
              <dl className="settings-list">
                <div className="settings-row">
                  <dt>Email</dt>
                  <dd className="settings-email">{me?.email}</dd>
                </div>
                {me?.created_at && (
                  <div className="settings-row">
                    <dt>Зареєстровано</dt>
                    <dd>{formatShortDate(toDateStr(new Date(me.created_at)))}</dd>
                  </div>
                )}
              </dl>
              <button className="btn btn-ghost btn-sm" onClick={handleLogout}>
                Вийти з акаунта
              </button>
            </section>

            <QuickAddKeySection
              hasKey={Boolean(me?.has_quick_add_key)}
              onKeyChange={(has) => setMe((m) => (m ? { ...m, has_quick_add_key: has } : m))}
              exampleCategory={byKind.expense.active[0]?.name}
              showToast={showToast}
            />

            {CATEGORY_KINDS.map((kind) => (
              <CategoryKindSection
                key={kind}
                kind={kind}
                active={byKind[kind].active}
                archived={byKind[kind].archived}
                reload={loadCategories}
                showToast={showToast}
              />
            ))}
          </>
        )}
      </div>

      <div className={`toast ${toast.visible ? 'toast-show' : ''}`} role="status" aria-live="polite">
        {toast.text}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Quick-add key: only its sha256 is stored, so the plaintext exists in this
// component's state right after generation and nowhere else.
function QuickAddKeySection({ hasKey, onKeyChange, exampleCategory, showToast }) {
  const [key, setKey] = useState('');
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const keyInputRef = useRef(null);

  const quickAddUrl = absoluteApiUrl('/quick-add');
  // JSON-encoded so a name with quotes still yields a valid example body.
  const sampleCategory = JSON.stringify(exampleCategory || '<назва>');

  const handleGenerate = async () => {
    if (busy) return;
    if (
      hasKey &&
      !window.confirm(
        'Згенерувати новий ключ? Старий ключ одразу перестане працювати — його доведеться замінити в Apple Shortcuts.'
      )
    ) {
      return;
    }
    setBusy(true);
    setError('');
    setCopied(false);
    try {
      const { key: fresh } = await generateQuickAddKey();
      setKey(fresh);
      onKeyChange(true);
    } catch (err) {
      setError(apiError(err, 'Не вдалося згенерувати ключ'));
    } finally {
      setBusy(false);
    }
  };

  const handleRevoke = async () => {
    if (busy) return;
    if (!window.confirm('Відкликати ключ? Швидке додавання з Apple Shortcuts перестане працювати.')) return;
    setBusy(true);
    setError('');
    try {
      await revokeQuickAddKey();
      setKey('');
      onKeyChange(false);
      showToast('Ключ відкликано');
    } catch (err) {
      setError(apiError(err, 'Не вдалося відкликати ключ'));
    } finally {
      setBusy(false);
    }
  };

  const handleCopy = async () => {
    setError('');
    try {
      await navigator.clipboard.writeText(key);
      setCopied(true);
    } catch {
      // The Clipboard API needs a secure context and permission; fall back to
      // selecting the text so the legacy copy command (or the user) can take it.
      const input = keyInputRef.current;
      input?.focus();
      input?.select();
      let ok = false;
      try {
        ok = document.execCommand('copy');
      } catch {
        ok = false;
      }
      if (ok) setCopied(true);
      else setError('Не вдалося скопіювати автоматично — ключ виділено, скопіюйте його вручну');
    }
  };

  return (
    <section className="card settings-section">
      <h2 className="card-title">⚡ Швидке додавання (Apple Shortcuts)</h2>
      <p className="settings-text">
        Персональний ключ для заголовка <code>X-API-Key</code>. Ми зберігаємо лише його відбиток,
        тому показати ключ повторно неможливо — лише згенерувати новий.
      </p>
      <div className="settings-row">
        <span className="settings-muted">Статус</span>
        {hasKey ? <span className="positive">ключ активний</span> : <span className="settings-muted">ключа немає</span>}
      </div>

      {key && (
        <div className="key-box">
          <div className="field">
            <label className="field-label" htmlFor="quick-add-key">
              Ваш новий ключ
            </label>
            <div className="key-row">
              <div className="input-wrap no-suffix">
                <input
                  id="quick-add-key"
                  ref={keyInputRef}
                  className="mono"
                  type="text"
                  readOnly
                  value={key}
                  onFocus={(e) => e.target.select()}
                />
              </div>
              <button type="button" className="btn btn-primary btn-sm" onClick={handleCopy}>
                {copied ? 'Скопійовано ✓' : 'Копіювати'}
              </button>
            </div>
          </div>
          <div className="key-warning" role="note">
            ⚠️ Збережіть ключ зараз — після виходу з цієї сторінки його більше не буде показано.
          </div>
        </div>
      )}

      {error && (
        <div className="login-error" role="alert">
          {error}
        </div>
      )}

      <div className="settings-actions">
        <button className="btn btn-primary btn-sm" onClick={handleGenerate} disabled={busy}>
          {hasKey ? '🔄 Перегенерувати ключ' : '🔑 Згенерувати ключ'}
        </button>
        {hasKey && (
          <button className="btn btn-danger btn-sm" onClick={handleRevoke} disabled={busy}>
            Відкликати ключ
          </button>
        )}
      </div>

      <details className="shortcut-hint">
        <summary>Як налаштувати Apple Shortcut</summary>
        <ol>
          <li>
            Дія «Отримати вміст URL»: метод <code>POST</code>, адреса <code>{quickAddUrl}</code>.
          </li>
          <li>
            Заголовки: <code>X-API-Key: ваш ключ</code> і <code>Content-Type: application/json</code>.
          </li>
          <li>
            Тіло (JSON): <code>{'{ "category": "<назва>", "amount": 100 }'}</code>, за бажанням ще{' '}
            <code>"note"</code>. Назва — як у списку категорій нижче, регістр не важливий.
          </li>
          <li>
            Скасувати останній швидкий запис за сьогодні: <code>DELETE {absoluteApiUrl('/quick-add/last')}</code>{' '}
            з тим самим ключем — або кнопкою «Скасувати швидкий запис» на сторінці дня.
          </li>
        </ol>
        <pre className="code-block">
          {`curl -X POST ${quickAddUrl} \\
  -H "X-API-Key: <ваш ключ>" \\
  -H "Content-Type: application/json" \\
  -d '{ "category": ${sampleCategory}, "amount": 100 }'`}
        </pre>
      </details>
    </section>
  );
}

// ---------------------------------------------------------------------------
// One kind's categories: add / rename / reorder / archive. Every write is
// followed by a reload, so the list always shows the server's order and state.
function CategoryKindSection({ kind, active, archived, reload, showToast }) {
  const limit = CATEGORY_LIMITS[kind];
  const atLimit = active.length >= limit;
  const lastActive = active.length <= 1;
  const [newName, setNewName] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  /** Run one write; always reload afterwards (a failure may mean the list is stale). */
  const run = async (write, successText) => {
    setBusy(true);
    setError('');
    let ok = false;
    try {
      await write();
      ok = true;
      if (successText) showToast(successText);
    } catch (err) {
      setError(apiError(err));
    }
    await reload().catch(() => {});
    setBusy(false);
    return ok;
  };

  const handleAdd = async (e) => {
    e.preventDefault();
    if (busy || atLimit) return;
    const name = newName.trim();
    const invalid = nameError(name);
    if (invalid) return setError(invalid);
    if (await run(() => createCategory(kind, name), `Категорію «${name}» додано`)) setNewName('');
  };

  const startRename = (c) => {
    setEditingId(c.id);
    setEditName(c.name);
    setError('');
  };

  const cancelRename = () => {
    setEditingId(null);
    setError('');
  };

  const saveRename = async (c) => {
    if (busy) return;
    const name = editName.trim();
    if (name === c.name) return cancelRename();
    const invalid = nameError(name);
    if (invalid) return setError(invalid);
    if (await run(() => renameCategory(c.id, name), 'Назву змінено ✓')) setEditingId(null);
  };

  const move = (index, delta) => {
    const target = index + delta;
    if (busy || target < 0 || target >= active.length) return;
    // The server wants the complete set of active ids of this kind in the new order.
    const ids = active.map((c) => c.id);
    [ids[index], ids[target]] = [ids[target], ids[index]];
    run(() => reorderCategories(kind, ids));
  };

  const handleArchive = (c) => {
    if (busy || lastActive) return;
    const ok = window.confirm(
      `Архівувати категорію «${c.name}»? Вона зникне з форм і швидкого додавання, ` +
        'але її записи залишаться в історії та статистиці.'
    );
    if (ok) run(() => archiveCategory(c.id), `«${c.name}» архівовано`);
  };

  return (
    <section className="card settings-section">
      <div className="section-head">
        <h2 className="card-title section-title">{KIND_TITLES[kind]}</h2>
        <span
          className={`counter ${atLimit ? 'counter-full' : ''}`}
          aria-label={`Активних ${active.length} з ${limit}`}
        >
          {active.length}/{limit}
        </span>
      </div>

      <ul className="cat-list">
        {active.map((c, i) => (
          <li key={c.id} className="cat-row">
            <span className="dot" style={{ background: c.color }} aria-hidden="true" />
            {editingId === c.id ? (
              <form
                className="cat-rename"
                onSubmit={(e) => {
                  e.preventDefault();
                  saveRename(c);
                }}
              >
                <div className="input-wrap no-suffix">
                  <input
                    type="text"
                    aria-label={`Нова назва для «${c.name}»`}
                    value={editName}
                    maxLength={CATEGORY_NAME_MAX * 2}
                    autoFocus
                    onChange={(e) => {
                      setEditName(e.target.value);
                      if (error) setError('');
                    }}
                    onKeyDown={(e) => e.key === 'Escape' && cancelRename()}
                  />
                </div>
                <button type="submit" className="icon-btn" aria-label="Зберегти назву" disabled={busy}>
                  ✓
                </button>
                <button type="button" className="icon-btn" aria-label="Скасувати перейменування" onClick={cancelRename}>
                  ✕
                </button>
              </form>
            ) : (
              <>
                <span className="cat-name">{c.name}</span>
                <div className="cat-actions">
                  <button
                    className="icon-btn"
                    aria-label={`Перемістити «${c.name}» вище`}
                    title="Вище"
                    onClick={() => move(i, -1)}
                    disabled={busy || i === 0}
                  >
                    ↑
                  </button>
                  <button
                    className="icon-btn"
                    aria-label={`Перемістити «${c.name}» нижче`}
                    title="Нижче"
                    onClick={() => move(i, 1)}
                    disabled={busy || i === active.length - 1}
                  >
                    ↓
                  </button>
                  <button
                    className="icon-btn"
                    aria-label={`Перейменувати «${c.name}»`}
                    title="Перейменувати"
                    onClick={() => startRename(c)}
                    disabled={busy}
                  >
                    ✏️
                  </button>
                  <button
                    className="icon-btn icon-btn-danger"
                    aria-label={`Архівувати «${c.name}»`}
                    title={lastActive ? 'Має залишитися хоча б одна активна категорія' : 'Архівувати'}
                    onClick={() => handleArchive(c)}
                    disabled={busy || lastActive}
                  >
                    🗄️
                  </button>
                </div>
              </>
            )}
          </li>
        ))}
      </ul>

      {error && (
        <div className="login-error" role="alert">
          {error}
        </div>
      )}

      <form className="cat-add" onSubmit={handleAdd}>
        <div className="input-wrap no-suffix">
          <input
            type="text"
            aria-label={`Нова категорія: ${KIND_TITLES[kind].toLowerCase()}`}
            placeholder={atLimit ? 'Досягнуто ліміт' : 'Нова категорія'}
            maxLength={CATEGORY_NAME_MAX * 2}
            value={newName}
            disabled={atLimit}
            onChange={(e) => {
              setNewName(e.target.value);
              if (error) setError('');
            }}
          />
        </div>
        <button type="submit" className="btn btn-primary btn-sm" disabled={busy || atLimit}>
          Додати
        </button>
      </form>
      {atLimit && (
        <div className="field-hint">
          Максимум {limit} активних категорій. Архівуйте одну, щоб додати нову.
        </div>
      )}

      {archived.length > 0 && (
        <div className="archived-block">
          <div className="archived-title">Архівні ({archived.length})</div>
          <ul className="archived-list">
            {archived.map((c) => (
              <li key={c.id}>
                <span className="dot" style={{ background: c.color }} aria-hidden="true" />
                <span>{c.name}</span>
              </li>
            ))}
          </ul>
          <div className="field-hint">Записи архівних категорій залишаються в історії та статистиці.</div>
        </div>
      )}
    </section>
  );
}
