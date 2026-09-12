import { useEffect, useState } from 'react';
import { ConversationList } from '@/components/ConversationList';
import { AgentChat } from '@/components/AgentChat';
import { client } from '@/lib/client';
import { rendererEvents } from '@/lib/events';
import { Button } from '@/components/ui/button';
import { RefreshCw, Loader2, Settings, TrendingUp, MessageCircle, PanelLeftClose, PanelLeftOpen, ScrollText, Database, PictureInPicture2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { WechatDialog } from '@/components/wechat/WechatDialog';
import { WorkspaceTabBar } from '@/components/WorkspaceTabBar';
import { WorkspaceSwitcherPopover } from '@/components/WorkspaceSwitcherPopover';
import { WelcomeFirstRun } from '@/components/WelcomeFirstRun';
import { TitleBar } from '@/components/TitleBar';
import { NotificationCenter } from '@/components/NotificationCenter';
import DataCenterPage from '@/app/data-center/page';
import { WorkspaceRuleDialog } from '@/components/WorkspaceRuleDialog';
import { MarkdownFileDialog } from '@/components/MarkdownFileDialog';
import { NotesPanel } from '@/components/notes/NotesPanel';
import { CompanionPanel } from '@/components/companion/CompanionPanel';
import { ArticlePreview } from '@/components/ArticlePreview';

// Zustand stores
import { useWorkspaceStore } from '@/stores/workspace-store';
import { useArticleStore } from '@/stores/article-store';
import { useSettingsStore } from '@/stores/settings-store';
import { useSessionStore, isSentinelTabId, NOTES_TAB_ID, DATA_CENTER_TAB_ID, ARTICLE_TAB_ID } from '@/stores/session-store';
import { useUIStore } from '@/stores/ui-store';
import { useConversationStore } from '@/stores/conversation-store';
import { useTaskFocusStore } from '@/stores/task-focus-store';

export default function Home() {
  const openSettings = useUIStore((s) => s.openSettings);
  const rightPanelOpen = useUIStore((s) => s.rightPanelOpen);
  const toggleRightPanel = useUIStore((s) => s.toggleRightPanel);
  const leftPanelOpen = useUIStore((s) => s.leftPanelOpen);
  const toggleLeftPanel = useUIStore((s) => s.toggleLeftPanel);

  // 应用启动时加载设置
  const settingsLoaded = useSettingsStore((s) => s.loaded);
  const loadSettings = useSettingsStore((s) => s.loadSettings);
  useEffect(() => {
    if (!settingsLoaded) {
      loadSettings();
    }
  }, [settingsLoaded, loadSettings]);

  // 工作区状态
  const workspace = useWorkspaceStore((s) => s.workspace);
  const setWorkspace = useWorkspaceStore((s) => s.setWorkspace);
  const [loadingDefaultWs, setLoadingDefaultWs] = useState(true);
  // 总工作区数量（用于区分 "零工作区首次启动" vs "有工作区但未选" 两种场景）
  const [totalWorkspaceCount, setTotalWorkspaceCount] = useState<number | null>(null);

  // 启动时自动加载默认工作区
  useEffect(() => {
    if (!workspace) {
      (async () => {
        try {
          const [defaultWs, allResult] = await Promise.all([
            client.getDefault(),
            client.getAll(),
          ]);
          setTotalWorkspaceCount(allResult.workspaces?.length ?? 0);
          if (defaultWs) {
            setWorkspace(defaultWs);
          }
        } catch (err) {
          console.error(err);
        } finally {
          setLoadingDefaultWs(false);
        }
      })();
    } else {
      setLoadingDefaultWs(false);
    }
  }, []);
  const loadingFiles = useWorkspaceStore((s) => s.loadingFiles);
  const loadWorkspaceFiles = useWorkspaceStore((s) => s.loadWorkspaceFiles);
  const openStockWindow = useWorkspaceStore((s) => s.openStockWindow);
  const [wechatDialogOpen, setWechatDialogOpen] = useState(false);
  const [workspaceRuleDialogOpen, setWorkspaceRuleDialogOpen] = useState(false);

  // 文章状态（文章 tab 挂载由 selectedArticle 驱动）
  const selectedArticle = useArticleStore((s) => s.selectedArticle);

  // 多标签页状态（Tab 栏 UI 已抽取到 WorkspaceTabBar；这里只留内容区渲染需要的字段）
  const allTabs = useSessionStore((s) => s.tabs);
  const activeTabId = useSessionStore((s) => s.activeTabId);
  const openTab = useSessionStore((s) => s.openTab);
  const removeSessionWindow = useSessionStore((s) => s.removeSessionWindow);
  const sessionWindowIds = useSessionStore((s) => s.sessionWindowIds);
  const dataCenterTabOpen = useSessionStore((s) => s.dataCenterTabOpen);
  const openDataCenterTab = useSessionStore((s) => s.openDataCenterTab);

  // 当前激活对话对应的组 ID（哨兵 tab 或 groupId 空时为 null）
  const activeConv = useConversationStore((s) =>
    s.conversations.find((c) => c.id === activeTabId) ?? null
  );
  const currentGroupId = activeConv?.groupId || null;

  // 监听独立窗口关闭事件，恢复 Tab 到主窗口
  // 独立窗口关闭时：主进程 detachByWebContentsId 释放独立窗口的 attachment，
  // 然后 removeSessionWindow 使标签页重新可见（AgentChat 一直挂载，attachment 一直在）
  useEffect(() => {
    const unsub = rendererEvents.sessionWindowClosed.listen((data) => {
      removeSessionWindow(data.conversationId);
      // 如果 allTabs 中不存在该 tab（用户在弹出前就关闭了标签页），重新打开
      const exists = useSessionStore.getState().tabs.some(t => t.conversationId === data.conversationId);
      if (!exists) {
        openTab(data.conversationId, data.title, data.workspaceId);
      }
    });
    return () => unsub();
  }, [openTab, removeSessionWindow]);

  // 通知点击后定位到目标对话：顺序等待工作区切换完成再查找/选中对话，避免写入旧分片
  useEffect(() => {
    const unsub = rendererEvents.focusConversation.listen(({ workspaceId, conversationId }) => {
      (async () => {
        try {
          const allResult = await client.getAll();
          const targetWorkspace = allResult.workspaces?.find((w) => w.id === workspaceId);
          if (!targetWorkspace) return;
          const currentWs = useWorkspaceStore.getState().workspace;
          if (currentWs?.id !== workspaceId) {
            await setWorkspace(targetWorkspace);
          }
          const convResult = await client.getById({ workspaceId, conversationId });
          if (!convResult.conversation) return;
          useConversationStore.getState().selectConversation(convResult.conversation);
        } catch (err) {
          console.error('[focusConversation] 定位对话失败:', err);
        }
      })();
    });
    return () => unsub();
  }, [setWorkspace]);

  // 任务通知点击：确保工作区就绪后切到笔记页任务视图并选中该任务
  useEffect(() => {
    const unsub = rendererEvents.focusTask.listen(({ taskId, workspaceId }) => {
      (async () => {
        try {
          const allResult = await client.getAll();
          const targetWorkspace = allResult.workspaces?.find((w) => w.id === workspaceId);
          if (!targetWorkspace) return;
          const currentWs = useWorkspaceStore.getState().workspace;
          if (currentWs?.id !== workspaceId) {
            await setWorkspace(targetWorkspace);
          }
          useSessionStore.getState().switchTab(NOTES_TAB_ID);
          useTaskFocusStore.getState().requestTaskFocus(taskId);
        } catch (err) {
          console.error('[focusTask] 定位任务失败:', err);
        }
      })();
    });
    return () => unsub();
  }, [setWorkspace]);

  // 正在加载默认工作区时显示加载状态
  if (loadingDefaultWs) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // 无工作区时：
  // - 首次启动（没有任何工作区）→ 显示欢迎引导
  // - 有工作区但用户主动 "clearWorkspace"（清空默认）→ 同样走欢迎引导，
  //   让用户重新从 Popover 选择（A2.7 设置页的工作区管理 Tab 提供完整列表/删除/恢复）
  if (!workspace) {
    if (totalWorkspaceCount === 0) {
      return <WelcomeFirstRun />;
    }
    // 有历史工作区但当前未激活 → 简单提示并提供 Popover 入口
    return (
      <div className="h-full flex items-center justify-center bg-muted/20">
        <div className="max-w-md w-full bg-background rounded-xl border shadow-lg p-8 space-y-4 text-center">
          <h2 className="text-lg font-semibold">请选择一个工作区继续</h2>
          <p className="text-sm text-muted-foreground">
            检测到 {totalWorkspaceCount ?? 0} 个已有工作区，点击下方选择。
          </p>
          <div className="flex justify-center">
            <WorkspaceSwitcherPopover />
          </div>
        </div>
      </div>
    );
  }

  return (
    <main className="h-full flex flex-col">
      <TitleBar title="Dogear" />
      {/* 顶部导航栏 */}
      <header className="h-12 border-b flex items-center justify-between px-4 bg-background">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0"
            onClick={toggleLeftPanel}
            title={leftPanelOpen ? '折叠左侧面板' : '展开左侧面板'}
          >
            {leftPanelOpen ? (
              <PanelLeftClose className="w-4 h-4" />
            ) : (
              <PanelLeftOpen className="w-4 h-4" />
            )}
          </Button>
          <WorkspaceSwitcherPopover />
          <Button
            variant="ghost"
            size="sm"
            className="h-8 gap-1.5"
            onClick={() => setWorkspaceRuleDialogOpen(true)}
            title="编辑当前工作区的 agent.md"
          >
            <ScrollText className="w-4 h-4" />
            <span className="text-xs">工作区规则</span>
          </Button>
        </div>
        <div className="flex items-center gap-2">
          <NotificationCenter />
          <Button variant="outline" size="sm" onClick={openSettings}>
            <Settings className="w-4 h-4 mr-2" />
            设置
          </Button>
          <Button variant="outline" size="sm" onClick={openStockWindow}>
            <TrendingUp className="w-4 h-4 mr-2" />
            自选股
          </Button>
          <Button variant="outline" size="sm" onClick={openDataCenterTab}>
            <Database className="w-4 h-4 mr-2" />
            数据中心
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              client.openWorkbenchWindow().catch((err) => console.error('打开伴随工作台失败:', err));
            }}
            title="打开伴随工作台窗口"
          >
            <PictureInPicture2 className="w-4 h-4 mr-2" />
            工作台
          </Button>
          <Button variant="outline" size="sm" onClick={() => setWechatDialogOpen(true)}>
            <MessageCircle className="w-4 h-4 mr-2" />
            微信
          </Button>
          <Button variant="outline" size="sm" onClick={() => loadWorkspaceFiles()} disabled={loadingFiles}>
            {loadingFiles ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <RefreshCw className="w-4 h-4" />
            )}
          </Button>
        </div>
      </header>

      {/* 主内容区域：三栏布局 */}
      <div className="flex-1 flex overflow-hidden">
        {/* 左侧：对话列表，可折叠（里程碑 1.5 Step A2.5） */}
        <aside
          className={cn(
            'border-r bg-sidebar flex flex-col transition-all duration-200 overflow-hidden',
            leftPanelOpen ? 'w-64' : 'w-0 border-r-0',
          )}
        >
          <ConversationList />
        </aside>

        {/* 中间：对话窗口 */}
        <section className="flex-1 flex flex-col min-w-0">
          {/* 标签页头（抽取为独立组件：里程碑 1.5 Step A2.3） */}
          <WorkspaceTabBar />

          {/* 标签页内容：笔记 + 各会话同时挂载，按 activeTabId 切 display（弹出独立窗口期间也保持挂载，sessionWindowClosed 恢复前不卸载） */}
          <div className="flex-1 overflow-hidden relative">
            {/* 笔记：固定 Tab，常驻挂载 */}
            <div
              className="absolute inset-0 flex flex-col"
              style={{ display: activeTabId === NOTES_TAB_ID ? 'flex' : 'none' }}
            >
              <NotesPanel />
            </div>
            {/* 数据中心：可开关 Tab，打开期间常驻挂载，关闭即卸载 */}
            {dataCenterTabOpen && (
              <div
                className="absolute inset-0 flex flex-col"
                style={{ display: activeTabId === DATA_CENTER_TAB_ID ? 'flex' : 'none' }}
              >
                <DataCenterPage />
              </div>
            )}
            {/* 文章：选中即挂载（切会话 tab 保持挂载不重加载），清空选中即卸载 */}
            {selectedArticle !== null && (
              <div
                className="absolute inset-0 flex flex-col"
                style={{ display: activeTabId === ARTICLE_TAB_ID ? 'flex' : 'none' }}
              >
                <ArticlePreview />
              </div>
            )}
            {/* 会话：各自按 activeTabId 切显示，保持 AgentChat 挂载 */}
            {allTabs.map((tab) => (
              <div
                key={tab.conversationId}
                className="absolute inset-0"
                style={{ display: activeTabId === tab.conversationId && !sessionWindowIds.has(tab.conversationId) ? 'block' : 'none' }}
              >
                <AgentChat
                  placeholder="向 AI 助手提问..."
                  showStatusHint={false}
                  conversationIdOverride={tab.conversationId}
                  visible={activeTabId === tab.conversationId && !sessionWindowIds.has(tab.conversationId)}
                  workspaceId={tab.workspaceId}
                  rightPanelToggle={{ open: rightPanelOpen, onToggle: toggleRightPanel }}
                />
              </div>
            ))}
          </div>
        </section>

        {/* 右侧：伴随面板（仅会话 tab 显示；开关状态保留，切回会话 tab 按原状态恢复） */}
        {activeTabId !== null && !isSentinelTabId(activeTabId) && (
          <CompanionPanel workspaceId={workspace.id} groupId={currentGroupId} />
        )}
      </div>

      {/* 微信 Bot 控制 Dialog */}
      <WechatDialog open={wechatDialogOpen} onOpenChange={setWechatDialogOpen} />

      {/* 工作区规则 Dialog（里程碑 1.5 Step A2.6） */}
      <WorkspaceRuleDialog open={workspaceRuleDialogOpen} onOpenChange={setWorkspaceRuleDialogOpen} />

      {/* Markdown 文件预览 Dialog */}
      <MarkdownFileDialog />
    </main>
  );
}
