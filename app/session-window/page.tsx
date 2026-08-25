import { useParams } from 'react-router';
import { useState, useEffect } from 'react';
import { PanelLeft, PanelLeftClose, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { AgentChat } from '@/components/agent-chat/AgentChat';
import { WorkspaceExplorer } from '@/components/WorkspaceExplorer';
import { ArticlePreview } from '@/components/ArticlePreview';
import { client } from '@/lib/client';
import { cn } from '@/lib/utils';
import { useConversationStore } from '@/stores/conversation-store';
import { useWorkspaceStore } from '@/stores/workspace-store';
import { useSettingsStore } from '@/stores/settings-store';

export function SessionWindowPage() {
  const { conversationId } = useParams<{ conversationId: string }>();
  const [leftPanelOpen, setLeftPanelOpen] = useState(false);
  const [rightPanelOpen, setRightPanelOpen] = useState(true);
  const [ready, setReady] = useState(false);
  const [initError, setInitError] = useState<string | null>(null);
  const [windowWorkspaceId, setWindowWorkspaceId] = useState<string | null>(null);

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
      }

      // 5. 标记就绪 → 才渲染 AgentChat
      setReady(true);
    }
    init();
  }, [conversationId]);

  const title = conversations.find(c => c.id === conversationId)?.title || '会话窗口';

  return (
    <div className="h-screen flex flex-col bg-background">
      {/* 头部栏 */}
      <header className="h-10 border-b flex items-center px-3 gap-2 flex-shrink-0">
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={() => setLeftPanelOpen(!leftPanelOpen)}
          title={leftPanelOpen ? '折叠文件树' : '展开文件树'}
        >
          {leftPanelOpen ? <PanelLeftClose size={16} /> : <PanelLeft size={16} />}
        </Button>
        <span className="text-sm font-medium truncate flex-1">{title}</span>
      </header>

      {/* 主体 */}
      <div className="flex-1 flex overflow-hidden">
        {/* 左侧：可折叠的工作区文件树 */}
        {leftPanelOpen && (
          <aside className="w-56 border-r bg-muted/30 overflow-hidden flex-shrink-0">
            <WorkspaceExplorer />
          </aside>
        )}

        {/* 中间：AgentChat（必须等初始化完成后才渲染） */}
        <main className="flex-1 overflow-hidden">
          {initError ? (
            <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
              {initError}
            </div>
          ) : !ready ? (
            <div className="flex items-center justify-center h-full text-muted-foreground text-sm gap-2">
              <Loader2 className="w-4 h-4 animate-spin" />
              加载中...
            </div>
          ) : conversationId ? (
            <AgentChat
              conversationIdOverride={conversationId}
              visible
              workspaceId={windowWorkspaceId}
              showStatusHint={false}
              rightPanelToggle={{
                open: rightPanelOpen,
                onToggle: () => setRightPanelOpen(v => !v),
              }}
            />
          ) : null}
        </main>

        {/* 右侧：文章预览（可折叠） */}
        <aside
          className={cn(
            'border-l overflow-hidden flex-shrink-0 transition-[width]',
            rightPanelOpen ? 'w-80' : 'w-0 border-l-0'
          )}
        >
          <ArticlePreview />
        </aside>
      </div>
    </div>
  );
}
