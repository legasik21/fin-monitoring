import { Routes, Route, Navigate } from 'react-router-dom';
import LoginPage from './pages/LoginPage.jsx';
import RegisterPage from './pages/RegisterPage.jsx';
import WelcomePage from './pages/WelcomePage.jsx';
import DayPage from './pages/DayPage.jsx';
import StatisticsPage from './pages/StatisticsPage.jsx';
import GoalsPage from './pages/GoalsPage.jsx';
import SettingsPage from './pages/SettingsPage.jsx';
import { getToken } from './api.js';

// Gate protected routes: no token → straight to the login screen.
function RequireAuth({ children }) {
  return getToken() ? children : <Navigate to="/login" replace />;
}

const PROTECTED = [
  { path: '/', element: <WelcomePage /> },
  { path: '/day', element: <DayPage /> },
  { path: '/day/:date', element: <DayPage /> },
  { path: '/stats', element: <StatisticsPage /> },
  { path: '/goals', element: <GoalsPage /> },
  { path: '/settings', element: <SettingsPage /> },
];

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      {PROTECTED.map(({ path, element }) => (
        <Route key={path} path={path} element={<RequireAuth>{element}</RequireAuth>} />
      ))}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
