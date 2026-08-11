/**
 * 工作区多会话 Tab 栏（里程碑 1.5 Step A2.3，A2.8 增强右键菜单）
 *
 * 职责：
 * - 渲染活跃会话标签页（来自 session-store）
 * - 点击 Tab：切换聚焦，如 tab 所属工作区与当前不同，先切工作区再聚焦
 * - 关闭 Tab：释放后端 Query 会话（closeQueryBasedSession），再从 UI 移除
 * - 显示 StatusPulse 指示运行/等待确认状态
 * - 右键菜单：弹出到独立窗口、关闭标签页、关闭其他标签页
 * - hover 快捷入口：弹出按钮、关闭按钮（保留便于鼠标用户）
 *
 * 不负责：
 * - AgentChat 渲染（由调用方控制）
 * - 对话创建（由对话列表处理）
 */

import { ExternalLink, X, Home } from 'lucide-react';
import { toast } from 'sonner';
import { client } from '@/lib/client';
import { cn } from '@/lib/utils';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { StatusPulse } from '@/components/StatusPulse';
import { useSessionStore, type SessionTab, HOME_TAB_ID } from '@/stores/session-store';
import { useConversationStore } from '@/stores/conversation-store';
import { useWorkspaceStore } from '@/stores/workspace-store';

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
  const closeTabInternal = async (tab: SessionTab) => {
    if (tab.sessionId) {
      try {
        await client.closeQueryBasedSession({ sessionId: tab.sessionId });
      } catch (err) {
        console.error('关闭后端会话失败（忽略继续关闭 Tab）:', err);
      }
    }
    closeTab(tab.conversationId);
  };

  const handleCloseTab = async (tab: SessionTab, e: React.MouseEvent) => {
    e.stopPropagation();
    await closeTabInternal(tab);
  };

  /** 关闭其他标签页（右键菜单项） */
  const handleCloseOthers = async (tab: SessionTab) => {
    const targets = tabs.filter((t) => t.conversationId !== tab.conversationId);
    for (const t of targets) {
      await closeTabInternal(t);
    }
  };

  /** 弹出到独立窗口 */
  const popOutInternal = (tab: SessionTab) => {
    // 运行中的会话不能弹出：会造成前端两处监听 stream 事件冲突
    if (runningConversationIds.has(tab.conversationId)) {
      toast.warning('会话运行中无法弹出', {
        description: '等待当前回答结束后再试',
      });
      return;
    }
    client.openSessionWindow({
      conversationId: tab.conversationId,
      title: tab.conversationTitle,
    });
    // 标记为独立窗口，AgentChat 保持挂载以便 attachment 平滑过渡，
    // 收到 sessionWindowReady 事件后才安全关闭标签页
    addSessionWindow(tab.conversationId);
  };

  const handlePopOut = (tab: SessionTab, e: React.MouseEvent) => {
    e.stopPropagation();
    popOutInternal(tab);
  };

  return (
    <ScrollArea className="border-b bg-muted/30">
      <div className="flex items-center">
        <button
          onClick={() => switchTab(HOME_TAB_ID)}
          className={cn(
            'flex items-center gap-1.5 px-3 py-2 text-sm cursor-pointer border-r shrink-0',
            activeTabId === HOME_TAB_ID ? 'bg-background font-medium' : 'hover:bg-muted/50 text-muted-foreground',
          )}
          title="首页"
        >
          <Home className="w-3.5 h-3.5" />
          <span>首页</span>
        </button>
        {tabs.map((tab) => {
          const isActive = activeTabId === tab.conversationId;
          const isRunning = runningConversationIds.has(tab.conversationId);
          const isPending = pendingActionIds.has(tab.conversationId);
          const showPulse = isRunning;
          const canPopOut = !isRunning;

          return (
            <ContextMenu key={tab.conversationId}>
              <ContextMenuTrigger asChild>
                <div
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
                  {canPopOut && (
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
              </ContextMenuTrigger>
              <ContextMenuContent>
                <ContextMenuItem
                  onClick={() => popOutInternal(tab)}
                  disabled={!canPopOut}
                >
                  <ExternalLink className="w-3.5 h-3.5 mr-2" />
                  弹出到独立窗口
                </ContextMenuItem>
                <ContextMenuSeparator />
                <ContextMenuItem onClick={() => closeTabInternal(tab)}>
                  <X className="w-3.5 h-3.5 mr-2" />
                  关闭标签页
                </ContextMenuItem>
                <ContextMenuItem
                  onClick={() => handleCloseOthers(tab)}
                  disabled={tabs.length <= 1}
                >
                  关闭其他标签页
                </ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>
          );
        })}
      </div>
      <ScrollBar orientation="horizontal" />
    </ScrollArea>
  );
}
