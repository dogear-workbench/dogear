/**
 * 工作区多会话 Tab 栏（里程碑 1.5 Step A2.3）
 *
 * 职责：
 * - 渲染活跃会话标签页（来自 session-store）
 * - 点击 Tab：切换聚焦，如 tab 所属工作区与当前不同，先切工作区再聚焦
 * - 关闭 Tab：释放后端 Query 会话（closeQueryBasedSession），再从 UI 移除
 * - 显示 StatusPulse 指示运行/等待确认状态
 * - "弹出到独立窗口" 按钮
 *
 * 不负责：
 * - AgentChat 渲染（由调用方控制）
 * - 对话创建（由对话列表处理）
 */

import { ExternalLink, X } from 'lucide-react';
import { toast } from 'sonner';
import { client } from '@/lib/client';
import { cn } from '@/lib/utils';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { StatusPulse } from '@/components/StatusPulse';
import { useSessionStore, type SessionTab } from '@/stores/session-store';
import { useConversationStore } from '@/stores/conversation-store';
import { useWorkspaceStore } from '@/stores/workspace-store';
import { useUIStore } from '@/stores/ui-store';

export function WorkspaceTabBar() {
  const allTabs = useSessionStore((s) => s.tabs);
  const activeTabId = useSessionStore((s) => s.activeTabId);
  const sessionWindowIds = useSessionStore((s) => s.sessionWindowIds);
  const switchTab = useSessionStore((s) => s.switchTab);
  const closeTab = useSessionStore((s) => s.closeTab);
  const addSessionWindow = useSessionStore((s) => s.addSessionWindow);

  const pendingActionIds = useConversationStore((s) => s.pendingActionConversationIds);
  const runningConversationIds = useConversationStore((s) => s.runningConversationIds);
  const currentWorkspaceId = useWorkspaceStore((s) => s.workspace?.id);

  // 过滤掉已弹到独立窗口的 Tab（保持 AgentChat 挂载但不显示标签头）
  const tabs = allTabs.filter((t) => !sessionWindowIds.has(t.conversationId));

  if (tabs.length === 0) return null;

  /** Tab 点击：如 workspaceId 不同则先切换工作区，再聚焦 Tab */
  const handleTabClick = async (tab: SessionTab) => {
    if (tab.workspaceId && tab.workspaceId !== currentWorkspaceId) {
      // 跨工作区切换：拉取目标工作区信息
      try {
        const result = await client.getAll();
        const targetWs = result.workspaces?.find((w) => w.id === tab.workspaceId);
        if (targetWs) {
          await useWorkspaceStore.getState().setWorkspace(targetWs);
        } else {
          toast.warning('目标工作区不存在', {
            description: '该会话所属工作区可能已被删除',
          });
          return;
        }
      } catch (err) {
        console.error('切换工作区失败:', err);
        toast.error('切换工作区失败', {
          description: err instanceof Error ? err.message : String(err),
        });
        return;
      }
    }
    switchTab(tab.conversationId);
  };

  /** 关闭 Tab：释放后端 session + 从 UI 移除 */
  const handleCloseTab = async (tab: SessionTab, e: React.MouseEvent) => {
    e.stopPropagation();
    if (tab.sessionId) {
      try {
        await client.closeQueryBasedSession({ sessionId: tab.sessionId });
      } catch (err) {
        console.error('关闭后端会话失败（忽略继续关闭 Tab）:', err);
      }
    }
    closeTab(tab.conversationId);
    useUIStore.getState().removeSubAgents(tab.conversationId);
  };

  /** 弹出到独立窗口 */
  const handlePopOut = (tab: SessionTab, e: React.MouseEvent) => {
    e.stopPropagation();
    client.openSessionWindow({
      conversationId: tab.conversationId,
      title: tab.conversationTitle,
    });
    // 标记为独立窗口，AgentChat 保持挂载以便 attachment 平滑过渡，
    // 收到 sessionWindowReady 事件后才安全关闭标签页
    addSessionWindow(tab.conversationId);
  };

  return (
    <ScrollArea className="border-b bg-muted/30">
      <div className="flex items-center">
        {tabs.map((tab) => {
          const isActive = activeTabId === tab.conversationId;
          const isRunning = runningConversationIds.has(tab.conversationId);
          const isPending = pendingActionIds.has(tab.conversationId);
          const showPulse = tab.isStreaming || isRunning;

          return (
            <div
              key={tab.conversationId}
              className={cn(
                'group flex items-center gap-1.5 px-3 py-2 text-sm cursor-pointer border-r shrink-0 max-w-[200px]',
                isActive ? 'bg-background font-medium' : 'hover:bg-muted/50 text-muted-foreground',
              )}
              onClick={() => handleTabClick(tab)}
            >
              {showPulse && <StatusPulse isPending={isPending} size="sm" />}
              <span className="truncate">{tab.conversationTitle}</span>
              {showPulse && isPending && (
                <span className="text-[10px] text-blue-600 bg-blue-50 px-1 rounded shrink-0">等待确认</span>
              )}
              {!tab.isStreaming && !isRunning && (
                <button
                  className="ml-0.5 p-0.5 rounded hover:bg-muted shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                  title="弹出为独立窗口"
                  onClick={(e) => handlePopOut(tab, e)}
                >
                  <ExternalLink className="w-3 h-3" />
                </button>
              )}
              <button
                className="ml-0.5 p-0.5 rounded hover:bg-muted shrink-0"
                title="关闭标签页"
                onClick={(e) => handleCloseTab(tab, e)}
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          );
        })}
      </div>
      <ScrollBar orientation="horizontal" />
    </ScrollArea>
  );
}
