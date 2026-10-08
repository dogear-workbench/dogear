// lib/events.ts - 渲染层事件监听入口
// 使用延迟访问 window，避免 Next.js SSR 时 window is not defined
import { createEventHandlers } from '@egoist/tipc/renderer';
import type { RendererHandlers } from '../electron/main/tipc/renderer-handlers';

export const rendererEvents = createEventHandlers<RendererHandlers>({
  on: (...args: any[]) => window.ipcRenderer.on(...(args as [string, (...a: any[]) => void])),
  send: (...args: any[]) => window.ipcRenderer.send(...(args as [string, ...any[]])),
});
