import { toast } from 'sonner';
import { client } from '@/lib/client';
import { useSessionStore, isSentinelTabId, DRAFT_VIEW_ID } from '@/stores/session-store';
import { useConversationStore } from '@/stores/conversation-store';
import { useReferenceStore } from '@/stores/reference-store';
import { useWorkspaceStore } from '@/stores/workspace-store';
import { useInputFocusStore } from '@/stores/input-focus-store';
import { draftAnchorId } from '@/stores/draft-store';

/** 当前焦点会话 id；哨兵 tab（笔记/数据中心）返回 null；独立窗口回退到其唯一会话；草稿视图返回当前工作区伪锚 */
export function getFocusConversationId(): string | null {
  const { activeTabId } = useSessionStore.getState();
  if (activeTabId && activeTabId !== DRAFT_VIEW_ID && !isSentinelTabId(activeTabId)) return activeTabId;
  if (window.location.hash.startsWith('#/session-window/')) {
    return useConversationStore.getState().selectedConversation?.id ?? null;
  }
  if (activeTabId === DRAFT_VIEW_ID) {
    const wsId = useWorkspaceStore.getState().workspace?.id;
    if (wsId) return draftAnchorId(wsId);
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

/**
 * 取可写入引用的锚定会话：会话 tab / 独立窗口焦点优先，草稿视图直接锚当前工作区伪 ID（不回退，
 * 避免错锚最近活跃会话），哨兵 tab（文章等）回退切哨兵前开着的会话（prevConversationView，弹窗中/已关均视为失效）
 * → 无则当前工作区草稿；无工作区才拒绝
 */
export function requireReferenceAnchorId(): string | null {
  const direct = getFocusConversationId();
  if (direct) return direct;
  const { prevConversationView, getTab, isInSessionWindow } = useSessionStore.getState();
  const tab = prevConversationView !== null ? getTab(prevConversationView) : undefined;
  if (tab && !isInSessionWindow(tab.conversationId)) {
    if (tab.workspaceId !== useWorkspaceStore.getState().workspace?.id) {
      toast.warning('无法引用', { description: '最近活跃会话属于其他工作区，请先切换到该会话再引用' });
      return null;
    }
    return tab.conversationId;
  }
  const wsId = useWorkspaceStore.getState().workspace?.id;
  if (wsId) return draftAnchorId(wsId);
  toast.warning('请先打开会话再引用');
  return null;
}

/** 校验右栏引用项能否进当前焦点会话；放行返回 true，跨工作区 toast 拒绝并返回 false */
export function guardReferenceIntoFocus(): boolean {
  const { activeTabId, getTab } = useSessionStore.getState();
  const tab = getTab(activeTabId);
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
async function resolveNoteTitle(workspaceId: string, noteId: string, title: string): Promise<string> {
  if (title) return title;
  try {
    const result = await client.getNote({ workspaceId, noteId });
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
 * 锚定笔记到当前工作区草稿：工作区缺失或笔记跨区时 toast 拒绝并返回 false；
 * 成功则加引用芯片到草稿伪锚、切草稿视图、聚焦草稿输入框
 */
async function anchorNoteToDraft(note: { noteId: string; title: string; workspaceId: string }): Promise<boolean> {
  const workspace = useWorkspaceStore.getState().workspace;
  if (!workspace) {
    toast.warning('请先打开一个工作区，再引用笔记');
    return false;
  }
  if (note.workspaceId !== workspace.id) {
    toast.warning('无法引用', { description: '该笔记属于其他工作区，无法引用到当前草稿' });
    return false;
  }
  const anchorId = draftAnchorId(workspace.id);
  useReferenceStore.getState().addReferencedNote(
    {
      noteId: note.noteId,
      title: await resolveNoteTitle(note.workspaceId, note.noteId, note.title),
      workspaceId: note.workspaceId,
    },
    anchorId,
  );
  useSessionStore.getState().switchTab(DRAFT_VIEW_ID);
  useInputFocusStore.getState().requestFocus(anchorId);
  return true;
}

/**
 * 笔记卡一键引用进会话：草稿视图锚当前工作区伪 ID 并保持草稿视图；实体 tab 锚切哨兵前开着的会话
 * （以 session-store.prevConversationView 为权威，哨兵 tab 下 selectedConversation 有残留；已关则回草稿），
 * 无可锚会话时回退当前工作区草稿；无工作区才拒绝
 */
export async function referenceNoteIntoFocus(note: { noteId: string; title: string; workspaceId: string }): Promise<void> {
  const { activeTabId } = useSessionStore.getState();

  if (activeTabId === DRAFT_VIEW_ID) {
    await anchorNoteToDraft(note);
    return;
  }
  const { prevConversationView, getTab, isInSessionWindow } = useSessionStore.getState();
  const tab = prevConversationView !== null ? getTab(prevConversationView) : undefined;
  if (!tab) {
    await anchorNoteToDraft(note);
    return;
  }
  if (isInSessionWindow(tab.conversationId)) {
    toast.warning('目标会话已在独立窗口打开，无法引用');
    return;
  }

  const workspace = useWorkspaceStore.getState().workspace;
  if (!workspace || tab.workspaceId !== workspace.id) {
    let targetWorkspaceName: string | null = null;
    let sameId = false;
    try {
      const { workspaces } = await client.getAll();
      const target = workspaces.find((w) => w.id === tab.workspaceId);
      targetWorkspaceName = target?.name ?? null;
      sameId = target?.id === note.workspaceId;
    } catch {}
    if (!sameId) {
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
      title: await resolveNoteTitle(note.workspaceId, note.noteId, note.title),
      workspaceId: note.workspaceId,
    },
    tab.conversationId,
  );
  useSessionStore.getState().switchTab(tab.conversationId);
  useInputFocusStore.getState().requestFocus(tab.conversationId);
}

/** 从笔记/任务详情跳到来源会话：已开 tab 聚焦，独立窗口唤起窗口，未开走完整打开链路 */
export async function jumpToSourceConversation(source: { conversationId: string; title: string }): Promise<void> {
  const { getTab, isInSessionWindow } = useSessionStore.getState();
  if (getTab(source.conversationId)) {
    useSessionStore.getState().switchTab(source.conversationId);
    useInputFocusStore.getState().requestFocus(source.conversationId);
    return;
  }
  if (isInSessionWindow(source.conversationId)) {
    void client.openSessionWindow({ conversationId: source.conversationId, title: source.title || '未命名会话' });
    return;
  }

  const conversationStore = useConversationStore.getState();
  let conv = conversationStore.conversations.find((c) => c.id === source.conversationId);
  if (!conv && conversationStore.conversations.length === 0) {
    await conversationStore.loadConversations();
    conv = useConversationStore.getState().conversations.find((c) => c.id === source.conversationId);
  }
  if (!conv) {
    toast.info('会话不存在或已删除', { description: `「${source.title || '未命名会话'}」无法打开` });
    return;
  }

  const { getConversationTitle } = await import('@/components/conversation-list/utils');
  // 先 openTab 让 tab 带上 conv.workspaceId，跨工作区焦点联动依赖 tab.workspaceId 判定
  useSessionStore.getState().openTab(conv.id, getConversationTitle(conv), conv.workspaceId);
  await useConversationStore.getState().selectConversation(conv);
}
