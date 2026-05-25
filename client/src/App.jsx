import { Routes, Route, Navigate } from 'react-router-dom';
import WelcomePage from './pages/WelcomePage.jsx';
import DayPage from './pages/DayPage.jsx';
import StatisticsPage from './pages/StatisticsPage.jsx';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<WelcomePage />} />
      <Route path="/day" element={<DayPage />} />
      <Route path="/day/:date" element={<DayPage />} />
      <Route path="/stats" element={<StatisticsPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
