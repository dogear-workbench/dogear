import { toast } from 'sonner';
import { client } from '@/lib/client';
import { useSessionStore, HOME_TAB_ID, NOTES_TAB_ID, DATA_CENTER_TAB_ID } from '@/stores/session-store';
import { useConversationStore } from '@/stores/conversation-store';
import { useReferenceStore } from '@/stores/reference-store';
import { useWorkspaceStore } from '@/stores/workspace-store';
import { useInputFocusStore } from '@/stores/input-focus-store';

const SENTINEL_TAB_IDS = new Set([HOME_TAB_ID, NOTES_TAB_ID, DATA_CENTER_TAB_ID]);

/** 当前焦点会话 id；哨兵 tab（首页/笔记/数据中心）返回 null；独立窗口回退到其唯一会话 */
export function getFocusConversationId(): string | null {
  const { activeTabId } = useSessionStore.getState();
  if (activeTabId && !SENTINEL_TAB_IDS.has(activeTabId)) return activeTabId;
  if (window.location.hash.startsWith('#/session-window/')) {
    return useConversationStore.getState().selectedConversation?.id ?? null;
  }
  return null;
}

/** 取引用锚定会话 id；无焦点会话时 toast 拒绝并返回 null */
export function requireAnchorConversationId(): string | null {
  const id = getFocusConversationId();
  if (!id) {
    toast.warning('请先打开会话再引用');
  }
  return id;
}

/** 校验右栏引用项能否进当前焦点会话；放行返回 true，跨工作区 toast 拒绝并返回 false */
export function guardReferenceIntoFocus(): boolean {
  const { activeTabId, getTab } = useSessionStore.getState();
  const tab = getTab(activeTabId ?? '');
  // 首页 tab 无焦点会话可被污染，按设计放行
  if (!tab) return true;
  if (tab.workspaceId === useWorkspaceStore.getState().workspace?.id) return true;

  void (async () => {
    let focusWorkspaceName: string | null = null;
    try {
      const { workspaces } = await client.getAll();
      focusWorkspaceName = workspaces.find(w => w.id === tab.workspaceId)?.name ?? null;
    } catch {}
    toast.warning('无法引用', {
      description: focusWorkspaceName
        ? `该文件属于其他工作区，无法引用到当前会话（当前会话属于「${focusWorkspaceName}」）`
        : '该文件属于其他工作区，无法引用到当前会话',
    });
  })();
  return false;
}

/** 无标题卡显示截断正文：取正文首个非空行去 markdown 前缀截 40 字 */
async function resolveNoteTitle(workspacePath: string, noteId: string, title: string): Promise<string> {
  if (title) return title;
  try {
    const result = await client.getNote({ workspacePath, noteId });
    if ('note' in result && result.note) {
      const line = result.note.content
        .split(/\r?\n/)
        .map((l) => l.trim())
        .find((l) => l.length > 0);
      const text = line?.replace(/^(#+\s*|[-*>]\s*|\d+\.\s*)/, '').slice(0, 40);
      if (text) return text;
    }
  } catch {}
  return '（无标题）';
}

/**
 * 笔记卡一键引用进会话：工作区守卫 → 锚定最近活跃会话 → 激活该 tab + 聚焦输入框。
 * 锚定目标以 session-store.lastActiveConversationTabId 为权威（哨兵 tab 下 selectedConversation 有残留）
 */
export async function referenceNoteIntoFocus(note: { noteId: string; title: string; workspacePath: string }): Promise<void> {
  const { lastActiveConversationTabId, getTab, isInSessionWindow } = useSessionStore.getState();
  const tab = lastActiveConversationTabId ? getTab(lastActiveConversationTabId) : undefined;
  if (!tab) {
    toast.warning('请先打开一个会话，再引用笔记');
    return;
  }
  if (isInSessionWindow(tab.conversationId)) {
    toast.warning('目标会话已在独立窗口打开，无法引用');
    return;
  }

  const workspace = useWorkspaceStore.getState().workspace;
  if (!workspace || tab.workspaceId !== workspace.id) {
    let targetWorkspaceName: string | null = null;
    let samePath = false;
    try {
      const { workspaces } = await client.getAll();
      const target = workspaces.find((w) => w.id === tab.workspaceId);
      targetWorkspaceName = target?.name ?? null;
      samePath = target?.path === note.workspacePath;
    } catch {}
    if (!samePath) {
      toast.warning('无法引用', {
        description: targetWorkspaceName
          ? `该笔记属于其他工作区，无法引用到目标会话（目标会话属于「${targetWorkspaceName}」）`
          : '该笔记属于其他工作区，无法引用到目标会话',
      });
      return;
    }
  }

  useReferenceStore.getState().addReferencedNote(
    {
      noteId: note.noteId,
      title: await resolveNoteTitle(note.workspacePath, note.noteId, note.title),
      workspacePath: note.workspacePath,
    },
    tab.conversationId,
  );
  useSessionStore.getState().switchTab(tab.conversationId);
  useInputFocusStore.getState().requestFocus(tab.conversationId);
}

/** 从笔记详情跳回产生它的会话 tab（卡片来源身份证入口） */
export function jumpToSourceConversation(source: { conversationId: string; title: string }): void {
  const { getTab, isInSessionWindow } = useSessionStore.getState();
  const tab = getTab(source.conversationId);
  if (!tab) {
    toast.info('来源会话未打开', { description: `「${source.title || '未命名会话'}」未在标签页中打开` });
    return;
  }
  if (isInSessionWindow(source.conversationId)) {
    toast.info('来源会话已在独立窗口打开');
    return;
  }
  useSessionStore.getState().switchTab(source.conversationId);
  useInputFocusStore.getState().requestFocus(source.conversationId);
}
