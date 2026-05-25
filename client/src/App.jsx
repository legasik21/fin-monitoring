import { Routes, Route, Navigate } from 'react-router-dom';
import LoginPage from './pages/LoginPage.jsx';
import WelcomePage from './pages/WelcomePage.jsx';
import DayPage from './pages/DayPage.jsx';
import StatisticsPage from './pages/StatisticsPage.jsx';
import { getToken } from './api.js';

// Gate protected routes: no token → straight to the login screen.
function RequireAuth({ children }) {
  return getToken() ? children : <Navigate to="/login" replace />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/"
        element={
          <RequireAuth>
            <WelcomePage />
          </RequireAuth>
        }
      />
      <Route
        path="/day"
        element={
          <RequireAuth>
            <DayPage />
          </RequireAuth>
        }
      />
      <Route
        path="/day/:date"
        element={
          <RequireAuth>
            <DayPage />
          </RequireAuth>
        }
      />
      <Route
        path="/stats"
        element={
          <RequireAuth>
            <StatisticsPage />
          </RequireAuth>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
