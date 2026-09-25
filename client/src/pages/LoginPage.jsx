import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { login, setToken, getToken, apiError } from '../api.js';

export default function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Already logged in? Skip the login screen.
  useEffect(() => {
    if (getToken()) navigate('/', { replace: true });
  }, [navigate]);

  const clearError = () => error && setError('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (submitting) return;
    if (!email.trim() || !password) {
      setError('Вкажіть email і пароль');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      const { token } = await login(email, password);
      setToken(token);
      navigate('/', { replace: true });
    } catch (err) {
      // 401 carries "Невірний email або пароль" from the server — show it verbatim.
      setError(apiError(err, 'Не вдалося увійти'));
      setSubmitting(false);
    }
  };

  return (
    <div className="page login">
      <form className="card login-card auth-card fade-in-up" onSubmit={handleSubmit} noValidate>
        <h1 className="login-title">💰 Фінансовий щоденник</h1>
        <p className="auth-subtitle">Вхід до акаунта</p>

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
              name="password"
              autoComplete="current-password"
              placeholder="Ваш пароль"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                clearError();
              }}
            />
          </div>
        </label>

        {error && (
          <div className="login-error" role="alert">
            {error}
          </div>
        )}

        <button type="submit" className="btn btn-primary btn-lg" disabled={submitting}>
          {submitting ? 'Зачекайте…' : 'Увійти'}
        </button>

        <p className="auth-switch">
          Немає акаунта?{' '}
          <Link className="link" to="/register">
            Зареєструватися
          </Link>
        </p>
      </form>
    </div>
  );
}
