import axios from 'axios';

// Goes through the Vite dev proxy → http://localhost:3001/api
const api = axios.create({ baseURL: '/api' });

export const getAllDays = () => api.get('/days').then((r) => r.data);

export const getDay = (date) => api.get(`/days/${date}`).then((r) => r.data);

export const getToday = () => api.get('/days/today').then((r) => r.data);

// Upsert: PUT creates the row if it does not exist yet.
export const saveDay = (date, data) => api.put(`/days/${date}`, data).then((r) => r.data);

export const closeDay = (date) => api.patch(`/days/${date}/close`).then((r) => r.data);

export const getStats = (range) =>
  api.get('/stats', { params: { range } }).then((r) => r.data);

export default api;
