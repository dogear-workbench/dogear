// lib/log-report.ts - 渲染层异常兜底日志上报
// 崩溃路径专用：此时 tipc client 可能同样不可用，故有意直连 ipcRenderer 而非走 client
export function logToMain(level: 'warn' | 'error', message: string, stack?: string): void {
  try {
    window.ipcRenderer?.invoke('logFromRenderer', { level, message, stack });
  } catch {
    // IPC 不可用时忽略
  }
}
