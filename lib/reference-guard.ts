import { toast } from 'sonner';
import { client } from '@/lib/client';
import { useSessionStore, HOME_TAB_ID, NOTES_TAB_ID, DATA_CENTER_TAB_ID } from '@/stores/session-store';
import { useConversationStore } from '@/stores/conversation-store';
import { useWorkspaceStore } from '@/stores/workspace-store';

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
