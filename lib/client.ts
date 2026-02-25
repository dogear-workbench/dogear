// lib/client.ts - 渲染层唯一的 invoke 入口
import { createClient } from '@egoist/tipc/renderer';
import type { Router } from '../electron/main/tipc/index';

export const client = createClient<Router>({
  ipcInvoke: window.ipcRenderer.invoke,
});
