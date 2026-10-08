// types/electron.d.ts - 渲染层 window.ipcRenderer 类型声明
import type { IpcRendererEvent } from 'electron';

declare global {
  interface Window {
    ipcRenderer: {
      invoke: (channel: string, ...args: any[]) => Promise<any>;
      on: (channel: string, handler: (event: IpcRendererEvent, ...args: any[]) => void) => () => void;
      off: (channel: string, handler: (...args: any[]) => void) => void;
      send: (channel: string, ...args: any[]) => void;
    };
  }
}

export {};
