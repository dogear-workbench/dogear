import { create } from 'zustand';
import { toast } from 'sonner';
import { client } from '@/lib/client';
import { useWorkspaceStore } from './workspace-store';

export type TerminalFollowMode = 'follow' | 'pin';

export interface TerminalMeta {
  terminalId: string;
  conversationId: string | null;
  command: string;
  exited: boolean;
  exitCode?: number;
}

export interface TerminalGroups {
  mine: TerminalMeta[];
  session: TerminalMeta[];
  active: TerminalMeta | null;
}

interface TerminalState {
  terminals: Map<string, TerminalMeta>;
  activeTerminalId: string | null;
  followMode: TerminalFollowMode;
  pinnedConversationId: string | null;
  openUserShell: () => Promise<void>;
  killTerminal: (terminalId: string) => Promise<void>;
  setActive: (terminalId: string | null) => void;
  pinConversation: (conversationId: string) => void;
  setFollowMode: (mode: TerminalFollowMode) => void;
  ensureTerminals: () => Promise<void>;
  reconcileActive: (anchor: string | null) => void;
  handlePtyCreated: (event: { terminalId: string; conversationId: string | null; command: string }) => void;
  handlePtyExit: (event: { terminalId: string; exitCode: number }) => void;
}

/** 「会话」组可见性：conversationId 命中当前锚点（跟随态=activeTabId，固定态=pinnedId）；「我的」组=conversationId null 全显示 */
export function selectTerminalGroups(
  terminals: Map<string, TerminalMeta>,
  anchor: string | null,
  activeTerminalId: string | null,
): TerminalGroups {
  const mine: TerminalMeta[] = [];
  const session: TerminalMeta[] = [];
  for (const meta of terminals.values()) {
    if (meta.conversationId === null) {
      mine.push(meta);
    } else if (anchor !== null && meta.conversationId === anchor) {
      session.push(meta);
    }
  }
  const visibleIds = new Set([...mine, ...session].map((m) => m.terminalId));
  const stored = activeTerminalId !== null && visibleIds.has(activeTerminalId)
    ? terminals.get(activeTerminalId)
    : undefined;
  const active = stored ?? session[session.length - 1] ?? mine[mine.length - 1] ?? null;
  return { mine, session, active };
}

type DataSink = (data: string) => void;
const dataSinks = new Map<string, Set<DataSink>>();

/** xterm 组件收实时流的注册口；返回解绑函数。store 自身不攒内容 */
export function registerDataSink(terminalId: string, sink: DataSink): () => void {
  let sinks = dataSinks.get(terminalId);
  if (!sinks) {
    sinks = new Set();
    dataSinks.set(terminalId, sinks);
  }
  sinks.add(sink);
  return () => {
    const current = dataSinks.get(terminalId);
    if (!current) return;
    current.delete(sink);
    if (current.size === 0) dataSinks.delete(terminalId);
  };
}

export function dispatchPtyData(terminalId: string, data: string): void {
  const sinks = dataSinks.get(terminalId);
  if (!sinks) return;
  for (const sink of sinks) sink(data);
}

function upsertMeta(map: Map<string, TerminalMeta>, meta: TerminalMeta): Map<string, TerminalMeta> {
  const next = new Map(map);
  next.set(meta.terminalId, meta);
  return next;
}

export const useTerminalStore = create<TerminalState>((set, get) => ({
  terminals: new Map(),
  activeTerminalId: null,
  followMode: 'follow',
  pinnedConversationId: null,

  openUserShell: async () => {
    const cwd = useWorkspaceStore.getState().workspace?.path;
    if (!cwd) {
      toast.error('打开终端失败', { description: '请先打开工作区' });
      return;
    }
    try {
      const terminalId = await client.ptyCreate({ conversationId: null, cwd });
      get().handlePtyCreated({ terminalId, conversationId: null, command: '' });
      set({ activeTerminalId: terminalId });
    } catch (error) {
      toast.error('打开终端失败', { description: error instanceof Error ? error.message : String(error) });
    }
  },

  killTerminal: async (terminalId) => {
    try {
      await client.ptyKill({ terminalId });
    } catch (error) {
      console.warn('[terminal] kill 失败:', error);
    }
    set((state) => {
      if (!state.terminals.has(terminalId)) return state;
      const next = new Map(state.terminals);
      next.delete(terminalId);
      return { terminals: next };
    });
  },

  setActive: (terminalId) => set({ activeTerminalId: terminalId }),

  pinConversation: (conversationId) =>
    set({ followMode: 'pin', pinnedConversationId: conversationId }),

  setFollowMode: (mode) =>
    set(mode === 'follow'
      ? { followMode: 'follow', pinnedConversationId: null }
      : { followMode: 'pin' }),

  ensureTerminals: async () => {
    try {
      const list = await client.listPtyTerminals({});
      set((state) => {
        const next = new Map(state.terminals);
        for (const info of list) {
          next.set(info.terminalId, {
            terminalId: info.terminalId,
            conversationId: info.conversationId,
            command: info.command,
            exited: info.exited,
            exitCode: info.exitCode,
          });
        }
        return { terminals: next };
      });
    } catch (error) {
      console.warn('[terminal] 拉取终端列表失败:', error);
    }
  },

  reconcileActive: (anchor) => {
    const { terminals, activeTerminalId } = get();
    const { active } = selectTerminalGroups(terminals, anchor, activeTerminalId);
    const nextId = active?.terminalId ?? null;
    if (nextId !== activeTerminalId) set({ activeTerminalId: nextId });
  },

  handlePtyCreated: (event) => {
    set((state) => ({
      terminals: upsertMeta(state.terminals, {
        terminalId: event.terminalId,
        conversationId: event.conversationId,
        command: event.command,
        exited: false,
      }),
    }));
  },

  handlePtyExit: (event) => {
    set((state) => {
      const prev = state.terminals.get(event.terminalId);
      if (!prev) return state;
      return { terminals: upsertMeta(state.terminals, { ...prev, exited: true, exitCode: event.exitCode }) };
    });
  },
}));

if (typeof window !== 'undefined') {
  import('@/lib/events').then(({ rendererEvents }) => {
    rendererEvents.ptyCreated.listen((event) => {
      useTerminalStore.getState().handlePtyCreated(event);
    });
    rendererEvents.ptyData.listen((event) => {
      dispatchPtyData(event.terminalId, event.data);
    });
    rendererEvents.ptyExit.listen((event) => {
      useTerminalStore.getState().handlePtyExit(event);
    });
  });
}
