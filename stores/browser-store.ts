import { create } from 'zustand';
import { client } from '@/lib/client';
import { rendererEvents } from '@/lib/events';
import type { BrowserActionEvent, BrowserStreamStatus } from '../electron/main/services/browser/browser-action-stream';
import type { EmbeddedTabSnapshot } from '../electron/main/services/browser/embedded/types';
import type { HumanInterventionRequest } from '../electron/main/services/browser/human-intervention';

const MAX_EVENTS = 500;
const TABS_REFRESH_INTERVAL_MS = 2000;

interface PageViewState {
  tabs: EmbeddedTabSnapshot[];
  selfWindowId: number | null;
  presentedTabId: string | null;
  hasPageView: boolean;
}

export interface TabTakeoverEntry {
  tabId: string;
  active: boolean;
}

interface BrowserState {
  events: BrowserActionEvent[];
  status: BrowserStreamStatus;
  /** 历史是否已拉取（首次打开面板时一次性 RPC，之后靠增量广播） */
  loaded: boolean;
  /** 页面视图区状态（tab 列表 + 本窗口呈现状态），随动作流事件节流刷新 */
  view: PageViewState;
  humanInterventions: HumanInterventionRequest[];
  /** 当前被用户接管的 tab 列表（广播全量刷新，初始拉取从 view.tabs 派生） */
  takeovers: TabTakeoverEntry[];
  ensureLoaded: () => Promise<void>;
  ensureViewStateLoaded: () => Promise<void>;
  refreshStatus: () => Promise<void>;
  handleActionAdded: (event: BrowserActionEvent) => void;
  handlePresentationChanged: (data: { windowId: number; tabId: string | null }) => void;
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

let lastTabsRefreshAt = 0;

export const useBrowserStore = create<BrowserState>((set, get) => ({
  events: [],
  status: { running: false, launched: false, holder: null },
  loaded: false,
  view: { tabs: [], selfWindowId: null, presentedTabId: null, hasPageView: false },
  humanInterventions: [],
  takeovers: [],

  ensureLoaded: async () => {
    if (get().loaded) return;
    try {
      const { events, status } = await client.getBrowserActions({});
      set((state) => ({ events: mergeEvents(state.events, events), status, loaded: true }));
    } catch (error) {
      console.warn('[browser] 拉取动作历史失败:', error);
    }
  },

  ensureViewStateLoaded: async () => {
    try {
      const [view, pending] = await Promise.all([
        client.getPageViewState(),
        client.listHumanInterventions(),
      ]);
      lastTabsRefreshAt = Date.now();
      set({
        view,
        humanInterventions: pending,
        takeovers: view.tabs
          .filter((tab) => tab.takeover?.active)
          .map((tab) => ({ tabId: tab.tabId, active: true })),
      });
    } catch (error) {
      console.warn('[browser] 拉取页面视图状态失败:', error);
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
    const now = Date.now();
    if (now - lastTabsRefreshAt >= TABS_REFRESH_INTERVAL_MS) {
      lastTabsRefreshAt = now;
      void client
        .getPageViewState()
        .then((view) => set({ view }))
        .catch(() => {});
    }
  },

  handlePresentationChanged: (data) => {
    const view = get().view;
    if (view.selfWindowId === null || data.windowId !== view.selfWindowId) return;
    set({ view: { ...view, presentedTabId: data.tabId } });
  },
}));

if (typeof window !== 'undefined' && window.ipcRenderer) {
  rendererEvents.browserActionAdded.listen((event) => {
    useBrowserStore.getState().handleActionAdded(event);
  });
  rendererEvents.pagePresentationChanged.listen((data) => {
    useBrowserStore.getState().handlePresentationChanged(data);
  });
  rendererEvents.humanInterventionChanged.listen(({ pending }) => {
    useBrowserStore.setState({ humanInterventions: pending });
  });
  rendererEvents.tabTakeoverChanged.listen(({ takeovers }) => {
    useBrowserStore.setState({ takeovers });
  });
}
