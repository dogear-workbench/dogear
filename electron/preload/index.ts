/**
 * Electron 预加载脚本
 * 仅透传 ipcRenderer，类型安全由 @egoist/tipc 的 client/events 提供
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ipcRenderer', {
  invoke: ipcRenderer.invoke.bind(ipcRenderer),
  on: (channel: string, handler: (...args: any[]) => void) => {
    ipcRenderer.on(channel, handler);
    // 返回取消监听函数，供 createEventHandlers 的 listen 使用
    return () => ipcRenderer.removeListener(channel, handler);
  },
  off: ipcRenderer.off.bind(ipcRenderer),
  send: ipcRenderer.send.bind(ipcRenderer),
});
