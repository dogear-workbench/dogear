import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { toast } from 'sonner';
import { setupManualTaskToasts } from '@/lib/manual-task-toasts';
import { setupSettingsSync } from '@/lib/setup-settings-sync';
import './globals.css';

setupManualTaskToasts();
setupSettingsSync();

// ==================== 全局异常捕获 ====================

// 捕获同步异常
window.onerror = (message, source, lineno, colno, error) => {
  console.error('[全局异常]', message, source, lineno, colno, error);

  // 弹 toast 通知用户
  toast.error('发生未知错误', {
    description: String(message),
  });

  // 通过 IPC 发送到主进程写入日志
  try {
    if (window.ipcRenderer) {
      window.ipcRenderer.invoke('logFromRenderer', {
        level: 'error',
        message: `[全局异常] ${String(message)} at ${source}:${lineno}:${colno}`,
        stack: error?.stack,
      });
    }
  } catch {
    // IPC 不可用时忽略
  }
};

// 捕获未处理的 Promise 拒绝
window.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason;
  const message = reason instanceof Error ? reason.message : String(reason);

  console.error('[未处理的 Promise 拒绝]', reason);

  toast.error('发生未知错误', {
    description: message,
  });

  try {
    if (window.ipcRenderer) {
      window.ipcRenderer.invoke('logFromRenderer', {
        level: 'error',
        message: `[未处理的Promise拒绝] ${message}`,
        stack: reason instanceof Error ? reason.stack : undefined,
      });
    }
  } catch {
    // IPC 不可用时忽略
  }
});

// ==================== React 渲染 ====================

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
