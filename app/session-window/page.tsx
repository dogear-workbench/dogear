import { useParams } from 'react-router';
import { useState, useEffect } from 'react';
import { PanelLeft, PanelLeftClose } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { AgentChat } from '@/components/agent-chat/AgentChat';
import { WorkspaceExplorer } from '@/components/WorkspaceExplorer';
import { ArticlePreview } from '@/components/ArticlePreview';
import { client } from '@/lib/client';
import { useConversationStore } from '@/stores/conversation-store';
import { useWorkspaceStore } from '@/stores/workspace-store';
import { useSettingsStore } from '@/stores/settings-store';

export function SessionWindowPage() {
  const { conversationId } = useParams<{ conversationId: string }>();
  const [leftPanelOpen, setLeftPanelOpen] = useState(false);

  const conversations = useConversationStore((s) => s.conversations);
  const loadConversations = useConversationStore((s) => s.loadConversations);
  const selectConversation = useConversationStore((s) => s.selectConversation);

  // 初始化：加载工作区、设置、对话列表并选中指定对话
  useEffect(() => {
    if (!conversationId) return;
    async function init() {
      // 独立窗口需要先初始化工作区和设置（与主窗口独立的渲染进程）
      if (!useWorkspaceStore.getState().workspace) {
        const defaultWs = await client.getDefault();
        if (defaultWs) {
          useWorkspaceStore.getState().setWorkspace(defaultWs);
        }
      }
      if (!useSettingsStore.getState().loaded) {
        await useSettingsStore.getState().loadSettings();
      }
      await loadConversations();
      const conv = useConversationStore.getState().conversations.find(c => c.id === conversationId);
      if (conv) {
        await selectConversation(conv);
      }
    }
    init();
  // eslint-disable-next-line react-hooks/exhaustive-deps
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

      {/* 主体：三栏（左可折叠文件树 + 中聊天 + 右预览） */}
      <div className="flex-1 flex overflow-hidden">
        {/* 左侧：可折叠的工作区文件树 */}
        {leftPanelOpen && (
          <aside className="w-56 border-r bg-muted/30 overflow-hidden flex-shrink-0">
            <WorkspaceExplorer />
          </aside>
        )}

        {/* 中间：AgentChat */}
        <main className="flex-1 overflow-hidden">
          {conversationId && (
            <AgentChat
              conversationIdOverride={conversationId}
              showStatusHint={false}
            />
          )}
        </main>

        {/* 右侧：文章预览 */}
        <aside className="w-80 border-l overflow-hidden flex-shrink-0">
          <ArticlePreview />
        </aside>
      </div>
    </div>
  );
}
