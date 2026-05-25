import axios from 'axios';

const TOKEN_KEY = 'fm_token';

export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const setToken = (token) => localStorage.setItem(TOKEN_KEY, token);
export const clearToken = () => localStorage.removeItem(TOKEN_KEY);

// Goes through the Vite dev proxy → http://localhost:3001/api
const api = axios.create({ baseURL: '/api' });

// Attach the bearer token (if any) to every outgoing request.
api.interceptors.request.use((config) => {
  const token = getToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Any 401 (other than the login attempt itself) means the token is gone or
// expired: drop it and bounce the user back to the login screen.
api.interceptors.response.use(
  (res) => res,
  (error) => {
    const status = error.response?.status;
    const isLoginRequest = (error.config?.url || '').includes('/auth/login');
    if (status === 401 && !isLoginRequest) {
      clearToken();
      if (window.location.pathname !== '/login') {
        window.location.assign('/login');
      }
    }
    return Promise.reject(error);
  }
);

export const login = (password) =>
  api.post('/auth/login', { password }).then((r) => r.data);

export const getAllDays = () => api.get('/days').then((r) => r.data);

export const getDay = (date) => api.get(`/days/${date}`).then((r) => r.data);

export const getToday = () => api.get('/days/today').then((r) => r.data);

// Upsert: PUT creates the row if it does not exist yet.
export const saveDay = (date, data) => api.put(`/days/${date}`, data).then((r) => r.data);

export const closeDay = (date) => api.patch(`/days/${date}/close`).then((r) => r.data);

export const getStats = (range) =>
  api.get('/stats', { params: { range } }).then((r) => r.data);

export default api;
