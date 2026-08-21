import { toast } from 'sonner';
import { client } from '@/lib/client';
import { useSessionStore } from '@/stores/session-store';
import { useWorkspaceStore } from '@/stores/workspace-store';

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
