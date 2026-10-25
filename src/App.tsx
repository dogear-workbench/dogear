import { useEffect } from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router';
import HomePage from '@/app/page';
import DataCenterPage from '@/app/data-center/page';
import { WorkbenchWindowPage } from '@/app/workbench-window/page';
import { NotesWindowPage } from '@/app/notes-window/page';
import { SessionWindowPage } from '@/app/session-window/page';
import { TitleBar } from '@/components/TitleBar';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { Toaster } from '@/components/ui/sonner';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { HumanInterventionDialog } from '@/components/HumanInterventionDialog';
import { useSyncStore } from '@/stores/sync-store';

export function App() {
  // 局域网同步事件全局订阅：同步完成/配对请求等 toast 与状态不依赖数据中心页是否打开
  useEffect(() => useSyncStore.getState().subscribe(), []);

  return (
    <ErrorBoundary fallback="app">
      <HashRouter>
        <Routes>
          <Route path="/" element={<ErrorBoundary fallback="page"><HomePage /></ErrorBoundary>} />
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

      <ConfirmDialog />
      <HumanInterventionDialog />
      <Toaster />
    </ErrorBoundary>
  );
}
