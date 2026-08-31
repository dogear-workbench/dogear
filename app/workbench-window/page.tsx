import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { client } from '@/lib/client';
import { CompanionPanel } from '@/components/companion/CompanionPanel';
import { useSettingsStore } from '@/stores/settings-store';
import { useWorkspaceStore } from '@/stores/workspace-store';
import { useConversationStore } from '@/stores/conversation-store';
import { useTerminalStore } from '@/stores/terminal-store';
import { useUIStore } from '@/stores/ui-store';

export function WorkbenchWindowPage() {
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [initError, setInitError] = useState<string | null>(null);

  const conversations = useConversationStore((s) => s.conversations);
  const pinnedId = useTerminalStore((s) => s.pinnedConversationId);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (!useSettingsStore.getState().loaded) {
          await useSettingsStore.getState().loadSettings();
        }

        const [defaultWs, allResult] = await Promise.all([client.getDefault(), client.getAll()]);
        if (cancelled) return;
        const ws = defaultWs ?? allResult.workspaces?.[0];
        if (!ws) {
          setInitError('没有可用工作区，请先在主窗口创建工作区');
          return;
        }

        // skipSetDefault：不回写默认工作区，避免独立窗口影响主窗口
        await useWorkspaceStore.getState().setWorkspace(ws, { skipSetDefault: true });
        await useConversationStore.getState().loadConversations();
        if (cancelled) return;

        // 终端默认固定模式：钉住最近活跃会话（conversations 按 updatedAt 倒序）
        const convs = useConversationStore.getState().conversations;
        if (convs.length > 0) {
          useTerminalStore.getState().pinConversation(convs[0].id);
        }
        useUIStore.getState().setRightPanelTab('terminal');

        setWorkspaceId(ws.id);
      } catch (err) {
        console.error('[workbench-window] 初始化失败:', err);
        if (!cancelled) setInitError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // 话题 tab 跟随终端钉住的会话（工作台窗口的"当前会话"锚点即终端固定目标）
  const groupId = (pinnedId && conversations.find((c) => c.id === pinnedId)?.groupId) || null;

  return (
    <div className="h-full flex bg-background">
      {initError ? (
        <div className="flex-1 flex items-center justify-center px-6 text-sm text-muted-foreground text-center">
          {initError}
        </div>
      ) : !workspaceId ? (
        <div className="flex-1 flex items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" />
          加载中...
        </div>
      ) : (
        <CompanionPanel full workspaceId={workspaceId} groupId={groupId} />
      )}
    </div>
  );
}
