import axios from 'axios';

const TOKEN_KEY = 'fm_token';
const appBase =
  import.meta.env.BASE_URL === '/'
    ? ''
    : import.meta.env.BASE_URL.replace(/\/$/, '');
const withBase = (path) => `${appBase}${path}`;

export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const setToken = (token) => localStorage.setItem(TOKEN_KEY, token);
export const clearToken = () => localStorage.removeItem(TOKEN_KEY);

// Absolute URL of an API path on this deployment — shown in Settings so the
// Apple Shortcut can be pointed at the right host.
export const absoluteApiUrl = (path) => `${window.location.origin}${withBase(`/api${path}`)}`;

// Goes through the Vite dev proxy → http://localhost:3001/api
const api = axios.create({ baseURL: withBase('/api') });

// Attach the bearer token (if any) to every outgoing request.
api.interceptors.request.use((config) => {
  const token = getToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Any 401 means the token is gone or expired: drop it and bounce the user back to
// the login screen. Login/registration failures are excluded — there a 401/4xx is
// a form error the page shows itself, not an expired session.
const PUBLIC_AUTH_PATHS = ['/auth/login', '/auth/register'];

api.interceptors.response.use(
  (res) => res,
  (error) => {
    const status = error.response?.status;
    const url = error.config?.url || '';
    const isPublicAuth = PUBLIC_AUTH_PATHS.some((p) => url.includes(p));
    if (status === 401 && !isPublicAuth) {
      clearToken();
      const loginPath = withBase('/login');
      if (window.location.pathname !== loginPath) {
        window.location.assign(loginPath);
      }
    }
    return Promise.reject(error);
  }
);

/**
 * The Ukrainian message to show for a failed request: the server's `{ error }`
 * when there is one (it is authoritative for limits/validation), a connection
 * message when the request never got a response, otherwise `fallback`.
 */
export function apiError(err, fallback = 'Щось пішло не так. Спробуйте ще раз') {
  const message = err?.response?.data?.error;
  if (typeof message === 'string' && message) return message;
  if (err && !err.response) return 'Помилка з’єднання з сервером';
  return fallback;
}

// ---- auth & account ----
// `categories` = { income: string[], expense: string[] }; an empty kind gets the default.
export const register = (email, password, categories) =>
  api.post('/auth/register', { email, password, categories }).then((r) => r.data);

export const login = (email, password) =>
  api.post('/auth/login', { email, password }).then((r) => r.data);

export const getMe = () => api.get('/auth/me').then((r) => r.data);

// Returns { key } — the plaintext is only ever sent once.
export const generateQuickAddKey = () => api.post('/auth/quick-add-key').then((r) => r.data);

export const revokeQuickAddKey = () => api.delete('/auth/quick-add-key').then((r) => r.data);

// ---- categories ----
export const getCategories = ({ includeArchived = false } = {}) =>
  api
    .get('/categories', { params: includeArchived ? { include_archived: 1 } : undefined })
    .then((r) => r.data);

export const createCategory = (kind, name) =>
  api.post('/categories', { kind, name }).then((r) => r.data);

export const renameCategory = (id, name) =>
  api.patch(`/categories/${id}`, { name }).then((r) => r.data);

// `ids` must be exactly the active categories of `kind`, in the new order.
export const reorderCategories = (kind, ids) =>
  api.put('/categories/order', { kind, ids }).then((r) => r.data);

// "Delete" = archive: the category leaves the forms, its entries stay in history.
export const archiveCategory = (id) => api.delete(`/categories/${id}`).then((r) => r.data);

// ---- days ----
export const getAllDays = () => api.get('/days').then((r) => r.data);

// DaySummary & { transactions }; 404 when the day has no row yet.
export const getDay = (date) => api.get(`/days/${date}`).then((r) => r.data);

export const getToday = () => api.get('/days/today').then((r) => r.data);

export const closeDay = (date) => api.patch(`/days/${date}/close`).then((r) => r.data);

// ---- transactions ----
// Returns { transaction, day }; adding to a closed day reopens it.
export const addTransaction = ({ category_id, amount, date, note }) =>
  api.post('/transactions', { category_id, amount, date, note }).then((r) => r.data);

// Returns { ok, day } — `day` is null when the emptied open day was removed.
export const deleteTransaction = (id) => api.delete(`/transactions/${id}`).then((r) => r.data);

// The in-app "undo" for Apple Shortcuts: removes today's latest quick_add entry.
// Returns { ok, date, removed, totals }.
export const undoLastQuickAdd = () =>
  api.delete('/transactions/last-quick-add').then((r) => r.data);

// ---- stats ----
export const getStats = (range) =>
  api.get('/stats', { params: { range } }).then((r) => r.data);

export const getStreak = () => api.get('/stats/streak').then((r) => r.data);

export const getCalendar = (year) =>
  api.get('/stats/calendar', { params: { year } }).then((r) => r.data);

export const getMonthly = (month) =>
  api.get('/stats/monthly', { params: { month } }).then((r) => r.data);

// ---- goals ----
export const getGoals = () => api.get('/goals').then((r) => r.data);

export const createGoal = (data) => api.post('/goals', data).then((r) => r.data);

export const updateGoal = (id, data) => api.patch(`/goals/${id}`, data).then((r) => r.data);

export const deleteGoal = (id) => api.delete(`/goals/${id}`).then((r) => r.data);

export default api;
