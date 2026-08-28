import { HashRouter, Routes, Route, Navigate } from 'react-router';
import HomePage from '@/app/page';
import SettingsPage from '@/app/settings/page';
import DebugPage from '@/app/debug/page';
import StockPage from '@/app/stocks/page';
import WechatPage from '@/app/wechat/page';
import DataCenterPage from '@/app/data-center/page';
import { SessionWindowPage } from '@/app/session-window/page';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { Toaster } from '@/components/ui/sonner';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { useUIStore } from '@/stores/ui-store';

export function App() {
  const settingsOpen = useUIStore((s) => s.settingsOpen);

  return (
    <ErrorBoundary fallback="app">
      <HashRouter>
        <Routes>
          <Route path="/" element={<ErrorBoundary fallback="page"><HomePage /></ErrorBoundary>} />
          <Route path="/debug" element={<ErrorBoundary fallback="page"><DebugPage /></ErrorBoundary>} />
          <Route path="/stocks" element={<ErrorBoundary fallback="page"><StockPage /></ErrorBoundary>} />
          <Route path="/wechat" element={<ErrorBoundary fallback="page"><WechatPage /></ErrorBoundary>} />
          <Route path="/session-window/:conversationId" element={<ErrorBoundary fallback="page"><SessionWindowPage /></ErrorBoundary>} />
          <Route path="/data-center" element={<div className="h-screen"><ErrorBoundary fallback="page"><DataCenterPage /></ErrorBoundary></div>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </HashRouter>

      {settingsOpen && (
        <div className="fixed inset-0 z-50 bg-background">
          <ErrorBoundary fallback="page">
            <SettingsPage />
          </ErrorBoundary>
        </div>
      )}

      <ConfirmDialog />
      <Toaster />
    </ErrorBoundary>
  );
}
