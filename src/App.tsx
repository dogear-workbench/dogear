import { HashRouter, Routes, Route, Navigate } from 'react-router';
import HomePage from '@/app/page';
import SettingsPage from '@/app/settings/page';
import BookPage from '@/app/book/BookPage';
import AgentMonitorPage from '@/app/agent-monitor/page';
import DebugPage from '@/app/debug/page';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { Toaster } from '@/components/ui/sonner';

export function App() {
  return (
    <ErrorBoundary fallback="app">
      <HashRouter>
        <Routes>
          <Route path="/" element={<ErrorBoundary fallback="page"><HomePage /></ErrorBoundary>} />
          <Route path="/settings" element={<ErrorBoundary fallback="page"><SettingsPage /></ErrorBoundary>} />
          <Route path="/book/:id" element={<ErrorBoundary fallback="page"><BookPage /></ErrorBoundary>} />
          <Route path="/agent-monitor" element={<ErrorBoundary fallback="page"><AgentMonitorPage /></ErrorBoundary>} />
          <Route path="/debug" element={<ErrorBoundary fallback="page"><DebugPage /></ErrorBoundary>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </HashRouter>
      <Toaster />
    </ErrorBoundary>
  );
}
