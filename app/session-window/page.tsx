import { useParams } from 'react-router';
import { useState, useEffect } from 'react';
import { Loader2, PanelRightClose, PanelRightOpen } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { AgentChat } from '@/components/agent-chat/AgentChat';
import { CompanionPanel } from '@/components/companion/CompanionPanel';
import { client } from '@/lib/client';
import { rendererEvents } from '@/lib/events';
import { useConversationStore } from '@/stores/conversation-store';
import { useWorkspaceStore } from '@/stores/workspace-store';
import { useSettingsStore } from '@/stores/settings-store';
import { useUIStore } from '@/stores/ui-store';
import { useInterventionFocusStore } from '@/stores/intervention-focus-store';
import { TitleBar } from '@/components/TitleBar';
import { FileHistoryPanel } from '@/components/FileHistoryPanel';

export function SessionWindowPage() {
  const { conversationId } = useParams<{ conversationId: string }>();
  const [rightPanelOpen, setRightPanelOpen] = useState(true);
  const [ready, setReady] = useState(false);
  const [initError, setInitError] = useState<string | null>(null);
  const [windowWorkspaceId, setWindowWorkspaceId] = useState<string | null>(null);

  const workbenchWindowOpen = useUIStore((s) => s.workbenchWindowOpen);

  const conversations = useConversationStore((s) => s.conversations);
  const loadConversations = useConversationStore((s) => s.loadConversations);
  const selectConversation = useConversationStore((s) => s.selectConversation);

  // 初始化：通过全局查找定位对话所属工作区，再加载对话列表
  // AgentChat 必须在 workspace 和 conversation 都准备好后才渲染，否则 hooks 会用空 workspaceId 调 IPC
  useEffect(() => {
    if (!conversationId) return;
    setReady(false);
    setInitError(null);
    setWindowWorkspaceId(null);

    async function init() {
      // 1. 加载设置
      if (!useSettingsStore.getState().loaded) {
        await useSettingsStore.getState().loadSettings();
      }

      // 2. 通过全局查找获取对话及其所属工作区（避免依赖 getDefault 可能返回错误工作区）
      const result = await client.getConversationWithWorkspace({ conversationId: conversationId! });
      if (!result.conversation || !result.workspaceId) {
        setInitError(`找不到对话: ${conversationId}`);
        return;
      }
      setWindowWorkspaceId(result.workspaceId);

      // 3. 获取完整工作区对象并设置到 store（skipSetDefault 避免影响主窗口的默认工作区）
      const { workspaces } = await client.getAll();
      const ws = workspaces?.find((w: { id: string }) => w.id === result.workspaceId);
      if (!ws) {
        setInitError(`找不到工作区: ${result.workspaceId}`);
        return;
      }
      // 使用 setWorkspace 以触发 conversation-store 分片激活（A2.2 分片后必需）
      await useWorkspaceStore.getState().setWorkspace(ws, { skipSetDefault: true });

      // 4. 显式再加载一次对话列表（setWorkspace 内部的 fire-and-forget 可能未完成），然后选中目标对话
      await loadConversations();
      const conv = useConversationStore.getState().conversations.find(c => c.id === conversationId);
      if (conv) {
        await selectConversation(conv);
        // 一会话一窗口：激活即成为全局焦点（伴随工作台跟随），后续无变化；上报幂等失败静默
        void client.setFocusedConversation({ conversationId: conv.id, workspaceId: result.workspaceId }).catch(() => {});
      }

      // 5. 标记就绪 → 才渲染 AgentChat
      setReady(true);
    }
    init();

    // 互斥态冷启动同步：广播只通知变更，窗口创建时工作台已开启则需主动拉取
    void client.getWorkbenchWindowOpen().then(({ open }) => {
      useUIStore.getState().setWorkbenchWindowOpen(open);
    }).catch(() => {});

    // CompanionPanel 非 full 模式宽度受 ui-store.rightPanelOpen 控制，本窗口 store 实例默认折叠需显式展开
    useUIStore.getState().openRightPanel();
  }, [conversationId]);

  // 工作台窗口互斥：广播驱动本窗口右栏显隐；本地开关状态不动，关窗后按原状态恢复
  useEffect(() => {
    const unsubOpened = rendererEvents.workbenchWindowOpened.listen(() => {
      useUIStore.getState().setWorkbenchWindowOpen(true);
    });
    const unsubClosed = rendererEvents.workbenchWindowClosed.listen(() => {
      useUIStore.getState().setWorkbenchWindowOpen(false);
    });
    return () => {
      unsubOpened();
      unsubClosed();
    };
  }, []);

  // 人工介入卡焦点跳转：主进程定向发给本窗口，仅响应对话匹配的请求
  useEffect(() => {
    const unsub = rendererEvents.interventionFocus.listen(({ conversationId: targetId, interventionRequestId }) => {
      if (targetId !== conversationId) return;
      useInterventionFocusStore.getState().requestInterventionFocus(targetId, interventionRequestId);
    });
    return () => unsub();
  }, [conversationId]);

  const currentConv = conversations.find(c => c.id === conversationId);
  const title = currentConv?.title || '会话窗口';
  const groupId = currentConv?.groupId || null;
  const showRightPanel = rightPanelOpen && !workbenchWindowOpen;

  return (
    <div className="h-full flex flex-col bg-background">
      <TitleBar title={title} />
      {/* 头部栏：仅右栏折叠按钮，靠右（照主窗口 header 右侧习惯） */}
      <header className="h-10 border-b flex items-center justify-end px-3 gap-1.5 flex-shrink-0">
        {!workbenchWindowOpen && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0"
            onClick={() => setRightPanelOpen(!rightPanelOpen)}
            title={rightPanelOpen ? '折叠右侧面板' : '展开右侧面板'}
          >
            {rightPanelOpen ? (
              <PanelRightClose className="w-4 h-4" />
            ) : (
              <PanelRightOpen className="w-4 h-4" />
            )}
          </Button>
        )}
      </header>

      {/* 主体：左聊天 + 右 CompanionPanel */}
      <div className="flex-1 flex overflow-hidden">
        <main className="flex-1 min-w-0 overflow-hidden">
          {initError ? (
            <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
              {initError}
            </div>
          ) : !ready ? (
            <div className="flex items-center justify-center h-full text-muted-foreground text-sm gap-2">
              <Loader2 className="w-4 h-4 animate-spin" />
              加载中...
            </div>
          ) : (
            <div className="h-full relative">
              {/* 聊天位：display 切换保挂载，文章视图打开期间后台消息流不中断 */}
              <div className="absolute inset-0">
                {conversationId && (
                  <AgentChat
                    conversationIdOverride={conversationId}
                    visible
                    workspaceId={windowWorkspaceId}
                    showStatusHint={false}
                  />
                )}
              </div>
            </div>
          )}
        </main>

        {showRightPanel && windowWorkspaceId && (
          <CompanionPanel
            workspaceId={windowWorkspaceId}
            groupId={groupId}
            terminalAnchor={conversationId ?? null}
          />
        )}
      </div>

      {/* 文件历史 Dialog（CompanionPanel 内文件树右键入口） */}
      <FileHistoryPanel />
    </div>
  );
}
