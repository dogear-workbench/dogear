import { create } from 'zustand';
import { client } from '@/lib/client';
import { rendererEvents } from '@/lib/events';
import type { BrowserActionEvent, BrowserStreamStatus } from '../electron/main/services/browser/browser-action-stream';

const MAX_EVENTS = 500;

interface BrowserState {
  events: BrowserActionEvent[];
  status: BrowserStreamStatus;
  /** 历史是否已拉取（首次打开面板时一次性 RPC，之后靠增量广播） */
  loaded: boolean;
  ensureLoaded: () => Promise<void>;
  refreshStatus: () => Promise<void>;
  handleActionAdded: (event: BrowserActionEvent) => void;
}

function capEvents(events: BrowserActionEvent[]): BrowserActionEvent[] {
  return events.length > MAX_EVENTS ? events.slice(events.length - MAX_EVENTS) : events;
}

/** 拉取/订阅竞态合并：以服务端缓冲为基准，保留本地 seq 大于服务端末尾的增量尾部 */
function mergeEvents(local: BrowserActionEvent[], server: BrowserActionEvent[]): BrowserActionEvent[] {
  const maxSeq = server.length > 0 ? server[server.length - 1].seq : 0;
  const tail = local.filter((e) => e.seq > maxSeq);
  return capEvents([...server, ...tail]);
}

export const useBrowserStore = create<BrowserState>((set, get) => ({
  events: [],
  status: { running: false, launched: false, queued: 0, holder: null },
  loaded: false,

  ensureLoaded: async () => {
    if (get().loaded) return;
    try {
      const { events, status } = await client.getBrowserActions({});
      set((state) => ({ events: mergeEvents(state.events, events), status, loaded: true }));
    } catch (error) {
      console.warn('[browser] 拉取动作历史失败:', error);
    }
  },

  refreshStatus: async () => {
    try {
      const { status } = await client.getBrowserActions({});
      set({ status });
    } catch (error) {
      console.warn('[browser] 拉取运行状态失败:', error);
    }
  },

  handleActionAdded: (event) => {
    set((state) => ({ events: capEvents([...state.events, event]) }));
    void get().refreshStatus();
  },
}));

if (typeof window !== 'undefined' && window.ipcRenderer) {
  rendererEvents.browserActionAdded.listen((event) => {
    useBrowserStore.getState().handleActionAdded(event);
  });
}
