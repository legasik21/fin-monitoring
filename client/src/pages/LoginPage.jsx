import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { login, setToken, getToken } from '../api.js';

export default function LoginPage() {
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Already logged in? Skip the login screen.
  useEffect(() => {
    if (getToken()) navigate('/', { replace: true });
  }, [navigate]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (submitting || !password) return;
    setSubmitting(true);
    setError('');
    try {
      const { token } = await login(password);
      setToken(token);
      navigate('/', { replace: true });
    } catch (err) {
      if (err.response?.status === 401) {
        setError('Невірний пароль');
      } else {
        setError('Помилка з’єднання з сервером');
      }
      setSubmitting(false);
    }
  };

  return (
    <div className="page login">
      <form className="card login-card fade-in-up" onSubmit={handleSubmit}>
        <h1 className="login-title">💰 Фінансовий щоденник</h1>

        <div className="input-wrap login-input">
          <input
            type="password"
            placeholder="Введіть пароль"
            value={password}
            autoFocus
            onChange={(e) => {
              setPassword(e.target.value);
              if (error) setError('');
            }}
          />
        </div>

        {error && <div className="login-error">{error}</div>}

        <button type="submit" className="btn btn-primary btn-lg" disabled={submitting}>
          {submitting ? 'Зачекайте…' : 'Увійти'}
        </button>
      </form>
    </div>
  );
}
