// lib/client.ts - 渲染层唯一的 invoke 入口
// 使用延迟访问 window，避免 Next.js SSR 时 window is not defined
import { createClient } from '@egoist/tipc/renderer';
import type { Router } from '../electron/main/tipc/index';

export const client = createClient<Router>({
  ipcInvoke: (channel: string, ...args: any[]) => window.ipcRenderer.invoke(channel, ...args),
});
