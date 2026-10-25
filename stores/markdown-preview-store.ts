import { create } from 'zustand';
import { toast } from 'sonner';
import { useUIStore } from './ui-store';

/** 文件型阅读目标：渲染时经 client.readFile 读盘 */
export interface FileReadingTarget {
  kind: 'file';
  workspaceId: string;
  filePath: string;
  fileName: string;
  groupId: string | null;
}

/** inline 型阅读目标：内容随调用传入直接渲染（工具速览/共享文件等） */
export interface InlineReadingTarget {
  kind: 'inline';
  fileName: string;
  content: string;
}

export type ReadingTarget = FileReadingTarget | InlineReadingTarget;

export interface ReadingEntry {
  key: string;
  target: ReadingTarget;
  openedAt: number;
}

const MAX_RECENTS = 15;

export const readingEntryKey = (t: ReadingTarget): string =>
  t.kind === 'file' ? `file:${t.workspaceId}:${t.filePath}` : `inline:${t.fileName}`;

function upsertRecents(list: ReadingEntry[], target: ReadingTarget): ReadingEntry[] {
  const key = readingEntryKey(target);
  return [{ key, target, openedAt: Date.now() }, ...list.filter((e) => e.key !== key)].slice(0, MAX_RECENTS);
}

// 阅读面板只在主窗口的会话 tab 伴随渲染，独立窗口无哨兵 tab 概念
const isMainWindow = () => {
  const h = window.location.hash;
  return !h.startsWith('#/session-window') && !h.startsWith('#/workbench-window');
};

// session-store 反向关联 conversation 链，延迟导入防环
async function routeToReadingTab() {
  useUIStore.getState().openRightPanel();
  useUIStore.getState().setRightPanelTab('reading');
  if (!isMainWindow()) return;

  const { useSessionStore, isSentinelTabId, DRAFT_VIEW_ID } = await import('./session-store');
  const session = useSessionStore.getState();
  if (session.activeTabId === DRAFT_VIEW_ID || !isSentinelTabId(session.activeTabId)) return;
  session.fallbackActiveTab();
  const next = useSessionStore.getState().activeTabId;
  if (next === DRAFT_VIEW_ID || isSentinelTabId(next)) {
    toast.warning('没有可用的会话标签页，阅读面板无法显示');
  }
}

interface MarkdownPreviewState {
  /** 当前阅读目标；null 显示空态 */
  current: ReadingTarget | null;
  /** 最近阅读列表（含当前条目，新打开置顶） */
  recents: ReadingEntry[];
  open: (workspaceId: string, filePath: string, fileName: string, groupId?: string) => void;
  openInline: (fileName: string, content: string) => void;
  selectEntry: (key: string) => void;
  removeEntry: (key: string) => void;
  /** 关闭其他：移除非 keepKey 的全部条目 */
  removeOtherEntries: (keepKey: string) => void;
}

export const useMarkdownPreviewStore = create<MarkdownPreviewState>((set, get) => ({
  current: null,
  recents: [],
  open: (workspaceId, filePath, fileName, groupId) => {
    const target: FileReadingTarget = { kind: 'file', workspaceId, filePath, fileName, groupId: groupId ?? null };
    set((s) => ({ current: target, recents: upsertRecents(s.recents, target) }));
    void routeToReadingTab();
  },
  openInline: (fileName, content) => {
    const target: InlineReadingTarget = { kind: 'inline', fileName, content };
    set((s) => ({ current: target, recents: upsertRecents(s.recents, target) }));
    void routeToReadingTab();
  },
  selectEntry: (key) => {
    const entry = get().recents.find((e) => e.key === key);
    if (entry) set({ current: entry.target });
  },
  removeEntry: (key) => {
    const { current } = get();
    set((s) => ({
      recents: s.recents.filter((e) => e.key !== key),
      current: current && readingEntryKey(current) === key ? null : current,
    }));
  },
  removeOtherEntries: (keepKey) => {
    const { current } = get();
    set((s) => ({
      recents: s.recents.filter((e) => e.key === keepKey),
      current: current && readingEntryKey(current) !== keepKey ? null : current,
    }));
  },
}));
