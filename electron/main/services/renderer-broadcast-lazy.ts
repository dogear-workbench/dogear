// worker 线程可达的模块必须经由此层间接引用 renderer-broadcast：
// 后者静态依赖 @egoist/tipc/main（具名导入 ipcMain），在 worker_threads 里模块加载即抛
// SyntaxError；而 worker 里 BrowserWindow 恒为 undefined，广播本就是 no-op，加载失败静默跳过
export function broadcastConversationListChanged(
  workspaceId: string,
  mode: 'immediate' | 'debounced' = 'immediate',
): void {
  void (async () => {
    try {
      const m = await import('./renderer-broadcast.js');
      m.broadcastConversationListChanged(workspaceId, mode);
    } catch {
      // 见文件头注释
    }
  })();
}

export function broadcastGroupDataChanged(workspaceId: string, groupId: string): void {
  void (async () => {
    try {
      const m = await import('./renderer-broadcast.js');
      m.broadcastGroupDataChanged(workspaceId, groupId);
    } catch {
      // 见文件头注释
    }
  })();
}
