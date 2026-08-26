import { HashRouter, Routes, Route, Navigate } from 'react-router';
import HomePage from '@/app/page';
import SettingsPage from '@/app/settings/page';
import DebugPage from '@/app/debug/page';
import StockPage from '@/app/stocks/page';
import WechatPage from '@/app/wechat/page';
import { SessionWindowPage } from '@/app/session-window/page';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { Toaster } from '@/components/ui/sonner';
import { ConfirmDialog } from '@/components/ConfirmDialog';

export function App() {
  return (
    <ErrorBoundary fallback="app">
      <HashRouter>
        <Routes>
          <Route path="/" element={<ErrorBoundary fallback="page"><HomePage /></ErrorBoundary>} />
          <Route path="/debug" element={<ErrorBoundary fallback="page"><DebugPage /></ErrorBoundary>} />
          <Route path="/stocks" element={<ErrorBoundary fallback="page"><StockPage /></ErrorBoundary>} />
          <Route path="/wechat" element={<ErrorBoundary fallback="page"><WechatPage /></ErrorBoundary>} />
          <Route path="/session-window/:conversationId" element={<ErrorBoundary fallback="page"><SessionWindowPage /></ErrorBoundary>} />
          <Route path="/settings" element={<ErrorBoundary fallback="page"><SettingsPage /></ErrorBoundary>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </HashRouter>

      <ConfirmDialog />
      <Toaster />
    </ErrorBoundary>
  );
}
