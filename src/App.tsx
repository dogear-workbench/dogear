import { HashRouter, Routes, Route, Navigate } from 'react-router';
import HomePage from '@/app/page';
import SettingsPage from '@/app/settings/page';
import BookPage from '@/app/book/BookPage';
import AgentMonitorPage from '@/app/agent-monitor/page';
import DebugPage from '@/app/debug/page';

export function App() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/book/:id" element={<BookPage />} />
        <Route path="/agent-monitor" element={<AgentMonitorPage />} />
        <Route path="/debug" element={<DebugPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </HashRouter>
  );
}
