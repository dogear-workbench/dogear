import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { useUIStore } from '@/stores/ui-store';
import { isInConversationMode, useSessionStore } from '@/stores/session-store';
import { useSettingsStore } from '@/stores/settings-store';

export const LEFT_PANEL_MIN_WIDTH = 180;
export const LEFT_PANEL_MAX_WIDTH = 420;

// 中间聊天区保底宽度，两侧任一拖动压破即联动收起另一侧（观感定值）
const MIN_CENTER_WIDTH = 600;

const clampLeftWidth = (width: number) =>
  Math.min(LEFT_PANEL_MAX_WIDTH, Math.max(LEFT_PANEL_MIN_WIDTH, width));

export function applyStoredConversationListWidth(raw: number | undefined) {
  useUIStore.getState().setConversationListWidth(clampLeftWidth(raw ?? 256));
}

// 收起 = 覆写对应 store 开关（用户可手动再开）；拖动侧自身不收
export function resolveThreeColumnLinkage(dragSide: 'left' | 'right' | null) {
  const ui = useUIStore.getState();
  const inConversationMode = isInConversationMode(useSessionStore.getState().activeTabId);
  const leftVisible = inConversationMode && ui.conversationListOpen;
  const rightVisible = inConversationMode && ui.rightPanelOpen;
  const centerWidth = window.innerWidth
    - (leftVisible ? ui.conversationListWidth : 0)
    - (rightVisible ? ui.rightPanelWidth : 0);
  if (centerWidth >= MIN_CENTER_WIDTH) return;
  if (dragSide === 'right') {
    if (leftVisible) ui.closeConversationList();
    return;
  }
  if (rightVisible) {
    ui.closeRightPanel();
    return;
  }
  if (dragSide === null && leftVisible) ui.closeConversationList();
}

export const NOTES_LIST_MIN_WIDTH = 220;
export const NOTES_LIST_MAX_WIDTH = 560;

const clampNotesListWidth = (width: number) =>
  Math.min(NOTES_LIST_MAX_WIDTH, Math.max(NOTES_LIST_MIN_WIDTH, width));

export function applyStoredNotesListWidth(raw: number | undefined) {
  useUIStore.getState().setNotesListWidth(clampNotesListWidth(raw ?? 300));
}

const TASKS_LIST_MIN_WIDTH = 220;
const TASKS_LIST_MAX_WIDTH = 560;

const clampTasksListWidth = (width: number) =>
  Math.min(TASKS_LIST_MAX_WIDTH, Math.max(TASKS_LIST_MIN_WIDTH, width));

export function applyStoredTasksListWidth(raw: number | undefined) {
  useUIStore.getState().setTasksListWidth(clampTasksListWidth(raw ?? 300));
}

// settings.ui 非空才展开，保持 messageDisplayMode 必填性不被可选 spread 稀释
function persistUiWidth(
  key: 'conversationListWidth' | 'notesListWidth' | 'tasksListWidth',
  width: number,
  logTag: string,
) {
  const { settings, saveSettings } = useSettingsStore.getState();
  const ui = settings.ui && { ...settings.ui, [key]: width };
  saveSettings({ ...settings, ui })
    .catch((err) => console.error(`[${logTag}] 保存失败:`, err));
}

interface PanelWidthDragOptions {
  getWidth: () => number;
  setWidth: (width: number) => void;
  clamp: (width: number) => number;
  /** settings.ui 中的持久化键 */
  persistKey: 'conversationListWidth' | 'notesListWidth' | 'tasksListWidth';
  /** 拖动中联动判定（会话左栏三栏保底），无联动不传 */
  onDragMove?: () => void;
  logTag: string;
}

// options 每次渲染都是新对象，经 ref 同步避免监听器反复重挂
export function usePanelWidthDrag(options: PanelWidthDragOptions) {
  const [dragging, setDragging] = useState(false);
  const dragOrigin = useRef<{ x: number; width: number } | null>(null);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const startDrag = (e: ReactMouseEvent) => {
    e.preventDefault();
    dragOrigin.current = { x: e.clientX, width: optionsRef.current.getWidth() };
    setDragging(true);
  };

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: MouseEvent) => {
      if (!dragOrigin.current) return;
      const opts = optionsRef.current;
      opts.setWidth(opts.clamp(dragOrigin.current.width + e.clientX - dragOrigin.current.x));
      opts.onDragMove?.();
    };
    const onUp = () => setDragging(false);
    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      const opts = optionsRef.current;
      persistUiWidth(opts.persistKey, opts.getWidth(), opts.logTag);
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [dragging]);

  return { dragging, startDrag };
}

export function useConversationListDrag() {
  return usePanelWidthDrag({
    getWidth: () => useUIStore.getState().conversationListWidth,
    setWidth: useUIStore.getState().setConversationListWidth,
    clamp: clampLeftWidth,
    persistKey: 'conversationListWidth',
    onDragMove: () => resolveThreeColumnLinkage('left'),
    logTag: 'conversationListWidth',
  });
}

export function useNotesListDrag() {
  return usePanelWidthDrag({
    getWidth: () => useUIStore.getState().notesListWidth,
    setWidth: useUIStore.getState().setNotesListWidth,
    clamp: clampNotesListWidth,
    persistKey: 'notesListWidth',
    logTag: 'notesListWidth',
  });
}

export function useTasksListDrag() {
  return usePanelWidthDrag({
    getWidth: () => useUIStore.getState().tasksListWidth,
    setWidth: useUIStore.getState().setTasksListWidth,
    clamp: clampTasksListWidth,
    persistKey: 'tasksListWidth',
    logTag: 'tasksListWidth',
  });
}

export function useThreeColumnLinkage() {
  useEffect(() => {
    const onResize = () => resolveThreeColumnLinkage(null);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
}
