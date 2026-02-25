// lib/events.ts - 渲染层事件监听入口
import { createEventHandlers } from '@egoist/tipc/renderer';
import type { RendererHandlers } from '../electron/main/tipc/renderer-handlers';

export const rendererEvents = createEventHandlers<RendererHandlers>({
  on: window.ipcRenderer.on,
  send: window.ipcRenderer.send,
});
