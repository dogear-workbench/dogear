// 首页报告文件监视：监听 <configDir>/workspaces/<wsId>/dashboard.md 变更
// 触发广播 reportUpdated，让前端 Dashboard 自动重新加载（覆盖 review-trigger、
// 普通会话调 dogear__WriteReport、外部编辑等所有写入场景）。
import fs from 'node:fs';
import path from 'node:path';
import { BrowserWindow } from 'electron';
import { getRendererHandlers } from '@egoist/tipc/main';
import type { RendererHandlers } from '../../tipc/renderer-handlers.js';
import { getWorkspaceDataDir } from '../conversation-service.js';
import { mainLogger } from '../../agents/logger.js';

const DEBOUNCE_MS = 300;

let watcher: fs.FSWatcher | null = null;
const lastFiredAt = new Map<string, number>();

function workspacesRoot(): string {
  return path.dirname(getWorkspaceDataDir('__probe__'));
}

export function startDashboardWatcher(): void {
  if (watcher) return;
  const root = workspacesRoot();
  try {
    fs.mkdirSync(root, { recursive: true });
  } catch {
    // 已存在或权限问题，让 fs.watch 自己报
  }
  try {
    watcher = fs.watch(root, { recursive: true }, (_eventType, filename) => {
      if (!filename) return;
      const normalized = String(filename).replace(/\\/g, '/');
      const m = normalized.match(/^([^/]+)\/dashboard\.md$/);
      if (!m) return;
      const workspaceId = m[1];
      const now = Date.now();
      const last = lastFiredAt.get(workspaceId) ?? 0;
      if (now - last < DEBOUNCE_MS) return;
      lastFiredAt.set(workspaceId, now);
      for (const win of BrowserWindow.getAllWindows()) {
        if (win.isDestroyed()) continue;
        try {
          getRendererHandlers<RendererHandlers>(win.webContents)
            .reportUpdated.send({ workspaceId });
        } catch {
          // 窗口已销毁，忽略
        }
      }
    });
    mainLogger.info('[dashboard-watcher] started:', root);
  } catch (err) {
    mainLogger.warn('[dashboard-watcher] start failed:', err);
  }
}

export function stopDashboardWatcher(): void {
  if (watcher) {
    try { watcher.close(); } catch {
      // ignore
    }
    watcher = null;
  }
}
