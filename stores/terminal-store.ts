import { create } from 'zustand';
import { client } from '@/lib/client';
import type { TerminalEntry, TerminalStreamEvent } from '../electron/main/services/terminal-stream-service';

const MAX_ENTRIES = 200;

export type TerminalFollowMode = 'follow' | 'pin';

interface TerminalState {
  /** conversationId -> 命令条目（镜像主进程缓冲，事件驱动保持一致） */
  buffers: Map<string, TerminalEntry[]>;
  /** conversationId -> 运行中 toolCallId 集合（TerminalEntry 无 running 字段，靠此区分运行中/异常终止） */
  runningIds: Map<string, Set<string>>;
  followMode: TerminalFollowMode;
  pinnedConversationId: string | null;
  /** 拉一次历史缓冲（已有缓冲或拉取中则跳过） */
  ensureBuffer: (conversationId: string) => Promise<void>;
  /** 终端流事件入口（模块级订阅转发到这里，面板未打开也不丢事件） */
  handleStreamEvent: (event: TerminalStreamEvent) => void;
  pinConversation: (conversationId: string) => void;
  setFollowMode: (mode: TerminalFollowMode) => void;
  /** 清空某会话的本地终端展示 */
  clearBuffer: (conversationId: string) => void;
}

function findEntryIndex(entries: TerminalEntry[], toolCallId: string): number {
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entries[i].toolCallId === toolCallId) return i;
  }
  return -1;
}

function applyEvent(entries: TerminalEntry[], event: TerminalStreamEvent): TerminalEntry[] {
  switch (event.type) {
    case 'start': {
      const next = [...entries, {
        toolCallId: event.toolCallId,
        command: event.command,
        startedAt: event.startedAt,
        text: '',
      }];
      return next.length > MAX_ENTRIES ? next.slice(next.length - MAX_ENTRIES) : next;
    }
    case 'append': {
      const idx = findEntryIndex(entries, event.toolCallId);
      if (idx < 0) return entries;
      const next = entries.slice();
      next[idx] = { ...next[idx], text: next[idx].text + event.suffix };
      return next;
    }
    case 'replace': {
      const idx = findEntryIndex(entries, event.toolCallId);
      if (idx < 0) return entries;
      const next = entries.slice();
      next[idx] = { ...next[idx], text: event.text };
      return next;
    }
    case 'end': {
      const idx = findEntryIndex(entries, event.toolCallId);
      if (idx < 0) return entries;
      const next = entries.slice();
      next[idx] = { ...next[idx], exitCode: event.exitCode };
      return next;
    }
  }
}

const inflight = new Map<string, Promise<void>>();
const EMPTY_ENTRIES: TerminalEntry[] = [];

export const useTerminalStore = create<TerminalState>((set, get) => ({
  buffers: new Map(),
  runningIds: new Map(),
  followMode: 'follow',
  pinnedConversationId: null,

  ensureBuffer: async (conversationId) => {
    if (get().buffers.has(conversationId)) return;
    const pending = inflight.get(conversationId);
    if (pending) return pending;
    const task = (async () => {
      try {
        const entries = await client.getTerminalBuffer({ conversationId });
        set((state) => {
          const next = new Map(state.buffers);
          next.set(conversationId, entries);
          return { buffers: next };
        });
      } finally {
        inflight.delete(conversationId);
      }
    })();
    inflight.set(conversationId, task);
    return task;
  },

  handleStreamEvent: (event) => {
    set((state) => {
      const prevEntries = state.buffers.get(event.conversationId) ?? EMPTY_ENTRIES;
      const nextEntries = applyEvent(prevEntries, event);
      let buffers = state.buffers;
      if (nextEntries !== prevEntries) {
        buffers = new Map(state.buffers);
        buffers.set(event.conversationId, nextEntries);
      }
      let runningIds = state.runningIds;
      if (event.type === 'start' || event.type === 'end') {
        const nextSet = new Set(state.runningIds.get(event.conversationId));
        if (event.type === 'start') nextSet.add(event.toolCallId);
        else nextSet.delete(event.toolCallId);
        runningIds = new Map(state.runningIds);
        runningIds.set(event.conversationId, nextSet);
      }
      if (buffers === state.buffers && runningIds === state.runningIds) return state;
      return { buffers, runningIds };
    });
  },

  pinConversation: (conversationId) =>
    set({ followMode: 'pin', pinnedConversationId: conversationId }),

  setFollowMode: (mode) =>
    set(mode === 'follow'
      ? { followMode: 'follow', pinnedConversationId: null }
      : { followMode: 'pin' }),

  clearBuffer: (conversationId) =>
    set((state) => {
      const buffers = new Map(state.buffers);
      buffers.set(conversationId, []);
      const runningIds = new Map(state.runningIds);
      runningIds.set(conversationId, new Set());
      return { buffers, runningIds };
    }),
}));

if (typeof window !== 'undefined') {
  import('@/lib/events').then(({ rendererEvents }) => {
    rendererEvents.terminalStreamAppend.listen((event) => {
      useTerminalStore.getState().handleStreamEvent(event);
    });
  });
}
