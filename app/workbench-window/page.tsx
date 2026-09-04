import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { client } from '@/lib/client';
import { CompanionPanel } from '@/components/companion/CompanionPanel';
import { useSettingsStore } from '@/stores/settings-store';
import { useWorkspaceStore } from '@/stores/workspace-store';
import { useConversationStore } from '@/stores/conversation-store';
import { useTerminalStore } from '@/stores/terminal-store';
import { useUIStore } from '@/stores/ui-store';
import { TitleBar } from '@/components/TitleBar';

interface FocusedConv {
  conversationId: string;
  workspaceId: string;
}

export function WorkbenchWindowPage() {
  const [initError, setInitError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [focusedConv, setFocusedConv] = useState<FocusedConv | null>(null);

  const workspace = useWorkspaceStore((s) => s.workspace);
  const conversations = useConversationStore((s) => s.conversations);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (!useSettingsStore.getState().loaded) {
          await useSettingsStore.getState().loadSettings();
        }

        const [defaultWs, allResult, focusedResult] = await Promise.all([
          client.getDefault(),
          client.getAll(),
          client.getFocusedConversation().catch(() => ({ focused: null })),
        ]);
        if (cancelled) return;
        const focused = focusedResult.focused;
        // 初始工作区优先全局焦点会话所属区（冷启动直接落位，避免先默认区再切焦点的闪变）
        const ws = (focused && allResult.workspaces?.find((w) => w.id === focused.workspaceId))
          ?? defaultWs
          ?? allResult.workspaces?.[0];
        if (!ws) {
          setInitError('没有可用工作区，请先在主窗口创建工作区');
          return;
        }
        if (focused) setFocusedConv((prev) => prev ?? focused);

        // skipSetDefault：不回写默认工作区，避免独立窗口影响主窗口
        await useWorkspaceStore.getState().setWorkspace(ws, { skipSetDefault: true });
        if (cancelled) return;
        void useTerminalStore.getState().ensureTerminals();
        useUIStore.getState().setRightPanelTab('terminal');

        setReady(true);
      } catch (err) {
        console.error('[workbench-window] 初始化失败:', err);
        if (!cancelled) setInitError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // 全局焦点跟随：订阅广播（冷启动拉取在初始化 effect 内完成，RPC 响应晚于广播时仅无值生效防回退）
  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    import('@/lib/events').then(({ rendererEvents }) => {
      if (cancelled) return;
      unlisten = rendererEvents.focusedConversationChanged.listen((data) => {
        setFocusedConv({ conversationId: data.conversationId, workspaceId: data.workspaceId });
      });
    });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  // 跨工作区跟随：焦点会话属于其他工作区时整窗切换（文件树/会话列表随 setWorkspace 全套换新）
  useEffect(() => {
    if (!ready || !focusedConv) return;
    if (focusedConv.workspaceId === workspace?.id) return;
    void (async () => {
      try {
        const { workspaces } = await client.getAll();
        const target = workspaces?.find((w) => w.id === focusedConv.workspaceId);
        if (!target) return;
        await useWorkspaceStore.getState().setWorkspace(target, { skipSetDefault: true });
      } catch (err) {
        console.error('[workbench-window] 跟随切换工作区失败:', err);
      }
    })();
  }, [ready, focusedConv, workspace?.id]);

  // 话题/终端共用锚点：全局焦点会话优先；冷启动无焦点兜底最近会话（conversations 按 updatedAt 倒序）
  const anchorConvId = focusedConv?.conversationId ?? conversations[0]?.id ?? null;
  const groupId = (anchorConvId && conversations.find((c) => c.id === anchorConvId)?.groupId) || null;

  return (
    <div className="h-full flex bg-background">
      <TitleBar title="伴随工作台" />
      {initError ? (
        <div className="flex-1 flex items-center justify-center px-6 text-sm text-muted-foreground text-center">
          {initError}
        </div>
      ) : !ready || !workspace ? (
        <div className="flex-1 flex items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" />
          加载中...
        </div>
      ) : (
        <CompanionPanel full workspaceId={workspace.id} groupId={groupId} terminalAnchor={anchorConvId} />
      )}
    </div>
  );
}
