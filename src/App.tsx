import { HashRouter, Routes, Route, Navigate } from 'react-router';
import HomePage from '@/app/page';
import SettingsPage from '@/app/settings/page';
import DebugPage from '@/app/debug/page';
import StockPage from '@/app/stocks/page';
import WechatPage from '@/app/wechat/page';
import DataCenterPage from '@/app/data-center/page';
import { WorkbenchWindowPage } from '@/app/workbench-window/page';
import { NotesWindowPage } from '@/app/notes-window/page';
import { SessionWindowPage } from '@/app/session-window/page';
import { TitleBar } from '@/components/TitleBar';
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
          <Route path="/data-center" element={(
            <div className="h-full flex flex-col">
              <TitleBar title="数据中心" />
              <div className="flex-1 min-h-0">
                <ErrorBoundary fallback="page"><DataCenterPage /></ErrorBoundary>
              </div>
            </div>
          )} />
          <Route path="/workbench-window" element={<div className="h-full"><ErrorBoundary fallback="page"><WorkbenchWindowPage /></ErrorBoundary></div>} />
          <Route path="/notes-window" element={<div className="h-full"><ErrorBoundary fallback="page"><NotesWindowPage /></ErrorBoundary></div>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </HashRouter>

      {settingsOpen && (
        <div
          className="fixed inset-0 z-50 bg-background"
          style={{ paddingTop: 'env(titlebar-area-height, 36px)' }}
        >
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
