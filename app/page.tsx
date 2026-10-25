import { useEffect, useMemo, useRef, useState } from 'react';
import { ConversationList } from '@/components/ConversationList';
import { AgentChat, DraftChat } from '@/components/agent-chat';
import { client } from '@/lib/client';
import { rendererEvents } from '@/lib/events';
import { playDogearSound } from '@/lib/dogear-sound';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { FeishuPanel } from '@/components/feishu/FeishuPanel';
import { WorkspaceSwitcherPopover } from '@/components/WorkspaceSwitcherPopover';
import { WelcomeFirstRun } from '@/components/WelcomeFirstRun';
import { TopBar } from '@/components/TopBar';
import { ActivityRail } from '@/components/ActivityRail';
import { TitleBar } from '@/components/TitleBar';
import DataCenterPage from '@/app/data-center/page';
import TasksPanelPage from '@/app/tasks-panel/page';
import { ArchivePage } from '@/components/archive/ArchivePage';
import { FileHistoryPanel } from '@/components/FileHistoryPanel';
import { NotesPanel } from '@/components/notes/NotesPanel';
import { CompanionPanel } from '@/components/companion/CompanionPanel';
import SettingsPage from '@/app/settings/page';

// Zustand stores
import { useWorkspaceStore } from '@/stores/workspace-store';
import { useSettingsStore } from '@/stores/settings-store';
import { useSessionStore, isSentinelTabId, isInConversationMode, DRAFT_VIEW_ID, NOTES_TAB_ID, TASKS_TAB_ID, DATA_CENTER_TAB_ID, ARCHIVE_TAB_ID, FEISHU_TAB_ID, SETTINGS_TAB_ID } from '@/stores/session-store';
import { useUIStore } from '@/stores/ui-store';
import { useConversationStore } from '@/stores/conversation-store';
import { useDraftStore } from '@/stores/draft-store';
import { useTaskFocusStore } from '@/stores/task-focus-store';
import { useInterventionFocusStore } from '@/stores/intervention-focus-store';
import { applyStoredConversationListWidth, useConversationListDrag, useThreeColumnLinkage, resolveThreeColumnLinkage } from '@/hooks/use-panel-linkage';

export default function Home() {
  const conversationListOpen = useUIStore((s) => s.conversationListOpen);
  const conversationListWidth = useUIStore((s) => s.conversationListWidth);
  const listDrag = useConversationListDrag();
  useThreeColumnLinkage();

  // 工作台窗口互斥：开窗收右栏并隐藏开关，关窗恢复；广播驱动，重启即单窗口态
  useEffect(() => {
    const unsubOpened = rendererEvents.workbenchWindowOpened.listen(() => {
      useUIStore.getState().setWorkbenchWindowOpen(true);
      useUIStore.getState().closeRightPanel();
    });
    const unsubClosed = rendererEvents.workbenchWindowClosed.listen(() => {
      useUIStore.getState().setWorkbenchWindowOpen(false);
      useUIStore.getState().openRightPanel();
    });
    return () => {
      unsubOpened();
      unsubClosed();
    };
  }, []);

  // 哨兵窗口生命周期：弹出时 store 内部会把悬空的 activeTabId 落回可用 tab，关窗恢复哨兵 tab 显示
  useEffect(() => {
    const unsubNotesOpened = rendererEvents.notesWindowOpened.listen(() => {
      useSessionStore.getState().setNotesWindowOpen(true);
    });
    const unsubNotesClosed = rendererEvents.notesWindowClosed.listen(() => {
      useSessionStore.getState().setNotesWindowOpen(false);
    });
    const unsubDcOpened = rendererEvents.dataCenterWindowOpened.listen(() => {
      useSessionStore.getState().setDataCenterWindowOpen(true);
    });
    const unsubDcClosed = rendererEvents.dataCenterWindowClosed.listen(() => {
      useSessionStore.getState().setDataCenterWindowOpen(false);
    });
    return () => {
      unsubNotesOpened();
      unsubNotesClosed();
      unsubDcOpened();
      unsubDcClosed();
    };
  }, []);

  // 应用启动时加载设置
  const settingsLoaded = useSettingsStore((s) => s.loaded);
  const loadSettings = useSettingsStore((s) => s.loadSettings);
  useEffect(() => {
    if (!settingsLoaded) {
      loadSettings();
    }
  }, [settingsLoaded, loadSettings]);

  // 设置加载后初始化运行时宽度（clamp 180~420），后续设置变化同步跟进
  const storedConversationListWidth = useSettingsStore((s) => s.settings.ui?.conversationListWidth);
  useEffect(() => {
    if (settingsLoaded) {
      applyStoredConversationListWidth(storedConversationListWidth);
    }
  }, [settingsLoaded, storedConversationListWidth]);

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
  const feishuTabOpen = useSessionStore((s) => s.feishuTabOpen);


  // 多标签页状态（内容区渲染需要的字段）
  const allTabs = useSessionStore((s) => s.tabs);
  const activeTabId = useSessionStore((s) => s.activeTabId);
  const openTab = useSessionStore((s) => s.openTab);
  const removeSessionWindow = useSessionStore((s) => s.removeSessionWindow);
  const sessionWindowIds = useSessionStore((s) => s.sessionWindowIds);
  const dataCenterTabOpen = useSessionStore((s) => s.dataCenterTabOpen);
  const dataCenterWindowOpen = useSessionStore((s) => s.dataCenterWindowOpen);
  const archiveTabOpen = useSessionStore((s) => s.archiveTabOpen);
  const notesWindowOpen = useSessionStore((s) => s.notesWindowOpen);

  // 整页模式判定（rail 非对话项激活）：tab 栏隐藏、对话列表动画收起，会话 tab 状态与 AgentChat 挂载不动
  const inConversationMode = isInConversationMode(activeTabId);

  // 模式翻转瞬时收展（抑制过渡两帧），手动收开/设置改宽仍走 200ms 过渡：模式切换叠加页面大变化，过渡动画抢眼
  const prevModeRef = useRef(inConversationMode);
  const [modeFlipSuppress, setModeFlipSuppress] = useState(false);
  if (prevModeRef.current !== inConversationMode) {
    prevModeRef.current = inConversationMode;
    setModeFlipSuppress(true);
  }
  useEffect(() => {
    if (!modeFlipSuppress) return;
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => setModeFlipSuppress(false));
    });
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
  }, [modeFlipSuppress]);

  // 三栏保底联动不只拖动/resize 触发：手动收开任一侧也跑判定，展开压破保底即收另一侧
  const rightPanelOpen = useUIStore((s) => s.rightPanelOpen);
  const leftVisible = conversationListOpen && inConversationMode;
  const rightVisible = rightPanelOpen && inConversationMode;
  const prevVisibleRef = useRef({ left: leftVisible, right: rightVisible });
  useEffect(() => {
    const prev = prevVisibleRef.current;
    prevVisibleRef.current = { left: leftVisible, right: rightVisible };
    // 只响展开方向：收起不判定（中间只会更宽），并切断联动收起引发的回声误收另一侧
    const leftOpened = !prev.left && leftVisible;
    const rightOpened = !prev.right && rightVisible;
    if (!leftOpened && !rightOpened) return;
    resolveThreeColumnLinkage(leftOpened ? 'left' : 'right');
  }, [leftVisible, rightVisible]);

  // 当前激活对话对应的组 ID（哨兵 tab 或 groupId 空时为 null）
  const activeConv = useConversationStore((s) =>
    s.conversations.find((c) => c.id === activeTabId) ?? null
  );
  const currentGroupId = activeConv?.groupId || null;

  // 草稿语境：伴随面板与中间语境行的数据源（读当前工作区槽，无槽即空态）
  const isDraft = activeTabId === DRAFT_VIEW_ID;
  const draftSlot = useDraftStore((s) => s.slots[workspace?.id ?? '']);

  // 内容区渲染顺序与 tabs（LRU 顺序）解耦：重排只动 tab 栏 UI，内容容器按打开顺序稳定渲染，
  // 避免 React Placement 移动 DOM 触发 Chromium 重置滚动位置
  const renderOrderRef = useRef<string[]>([]);
  const orderedTabs = useMemo(() => {
    const byId = new Map(allTabs.map((t) => [t.conversationId, t]));
    const kept = renderOrderRef.current.filter((id) => byId.delete(id));
    const order = [...kept, ...byId.keys()];
    renderOrderRef.current = order;
    return order.map((id) => allTabs.find((t) => t.conversationId === id)!);
  }, [allTabs]);

  // 伴随面板跟随活动会话 tab 的工作区
  const activeTab = activeTabId && !isSentinelTabId(activeTabId)
    ? allTabs.find((t) => t.conversationId === activeTabId) ?? null
    : null;
  const companionWorkspaceId = isDraft
    ? workspace?.id ?? ''
    : activeTab?.workspaceId ?? workspace?.id ?? '';
  const companionGroupId = isDraft ? draftSlot?.groupId ?? null : currentGroupId;

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

  // 通知点击/人工介入卡跳转共用定位（实现已 store 化到 conversation-store，供顶栏搜索等入口复用）
  const locateConversation = useConversationStore((s) => s.locateConversation);

  // 通知点击后定位到目标对话
  useEffect(() => {
    const unsub = rendererEvents.focusConversation.listen(({ workspaceId, conversationId }) => {
      void locateConversation(workspaceId, conversationId);
    });
    return () => unsub();
  }, [locateConversation]);

  // 主进程下发的提示音指令：backgroundOnly 开启且应用前台时静默（intervention 提醒例外，始终响），
  // 音量/开关/节流仍由 playDogearSound 内部处理
  useEffect(() => {
    const unsub = rendererEvents.soundCue.listen(({ kind, appFocused }) => {
      const backgroundOnly = useSettingsStore.getState().settings.ui?.sound?.backgroundOnly ?? true;
      if (kind !== 'intervention' && backgroundOnly && appFocused) return;
      playDogearSound(kind, { force: !backgroundOnly || kind === 'intervention' });
    });
    return () => unsub();
  }, []);

  // 人工介入卡焦点跳转：切到目标会话后登记定位请求，AgentChat 滚动到卡片
  useEffect(() => {
    const unsub = rendererEvents.interventionFocus.listen(({ workspaceId, conversationId, interventionRequestId }) => {
      void locateConversation(workspaceId, conversationId).then(() => {
        useInterventionFocusStore.getState().requestInterventionFocus(conversationId, interventionRequestId);
      });
    });
    return () => unsub();
  }, [locateConversation]);

  // 任务通知点击：确保工作区就绪后切到任务面板并选中该任务（面板 CollabTaskSection 消费焦点请求）
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
          useSessionStore.getState().switchTab(TASKS_TAB_ID);
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
      <div className="h-full">
        <TitleBar />
        <div className="h-full flex items-center justify-center">
          <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  // 无工作区时：
  // - 首次启动（没有任何工作区）→ 显示欢迎引导
  // - 有工作区但用户主动 "clearWorkspace"（清空默认）→ 同样走欢迎引导，
  //   让用户重新从 Popover 选择（A2.7 设置页的工作区管理 Tab 提供完整列表/删除/恢复）
  if (!workspace) {
    if (totalWorkspaceCount === 0) {
      return (
        <div className="h-full">
          <TitleBar />
          <WelcomeFirstRun />
        </div>
      );
    }
    // 有历史工作区但当前未激活 → 简单提示并提供 Popover 入口
    return (
      <div className="h-full">
        <TitleBar />
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
      </div>
    );
  }

  return (
    <main className="h-full flex flex-col">
      <TopBar />

      {/* 主内容区域：rail + 三栏布局 */}
      <div className="flex-1 flex overflow-hidden">
        <ActivityRail />

        {/* 左侧：对话列表（conversationListOpen；整页模式动画收起但不覆写，切回会话模式按原状态恢复） */}
        <aside
          className={cn(
            'relative border-r bg-sidebar flex flex-col overflow-hidden',
            listDrag.dragging || modeFlipSuppress ? 'transition-none' : 'transition-all duration-200',
            conversationListOpen && inConversationMode ? 'border-r' : 'border-r-0',
          )}
          style={{ width: conversationListOpen && inConversationMode ? conversationListWidth : 0 }}
        >
          <ConversationList />
          {conversationListOpen && inConversationMode && (
            <div
              className="absolute right-0 top-0 bottom-0 w-[3px] z-10 cursor-col-resize hover:bg-primary/40"
              onMouseDown={listDrag.startDrag}
            />
          )}
        </aside>

        {/* 中间：对话窗口 */}
        <section className="flex-1 flex flex-col min-w-0">
          {/* 内容区：笔记 + 各会话同时挂载，按 activeTabId 切 display（弹出独立窗口期间也保持挂载，sessionWindowClosed 恢复前不卸载） */}
          <div className="flex-1 overflow-hidden relative">
            {/* 草稿视图：可直接打字，首条消息发送后落盘成会话 */}
            {activeTabId === DRAFT_VIEW_ID && (
              <div className="absolute inset-0 flex flex-col">
                <DraftChat />
              </div>
            )}
            {/* 笔记：常驻 tab，弹出独立窗口期间卸载 */}
            {!notesWindowOpen && (
              <div
                className="absolute inset-0 flex flex-col"
                style={{ display: activeTabId === NOTES_TAB_ID ? 'flex' : 'none' }}
              >
                <NotesPanel />
              </div>
            )}
            {/* 数据中心：可开关 Tab，打开期间常驻挂载，关闭即卸载；弹出独立窗口期间同样卸载 */}
            {dataCenterTabOpen && !dataCenterWindowOpen && (
              <div
                className="absolute inset-0 flex flex-col"
                style={{ display: activeTabId === DATA_CENTER_TAB_ID ? 'flex' : 'none' }}
              >
                <DataCenterPage />
              </div>
            )}
            {/* 任务：常驻 tab，rail 入口进入 */}
            <div
              className="absolute inset-0 flex flex-col"
              style={{ display: activeTabId === TASKS_TAB_ID ? 'flex' : 'none' }}
            >
              <TasksPanelPage />
            </div>
            {/* 归档：可开关 Tab，打开期间常驻挂载，关闭即卸载 */}
            {archiveTabOpen && (
              <div
                className="absolute inset-0 flex flex-col"
                style={{ display: activeTabId === ARCHIVE_TAB_ID ? 'flex' : 'none' }}
              >
                <ArchivePage workspaceId={workspace.id} />
              </div>
            )}
            {/* 飞书：可开关 Tab，打开期间常驻挂载，关闭即卸载 */}
            {feishuTabOpen && (
              <div
                className="absolute inset-0 flex flex-col"
                style={{ display: activeTabId === FEISHU_TAB_ID ? 'flex' : 'none' }}
              >
                <FeishuPanel />
              </div>
            )}
            {/* 设置：常驻 tab，rail 底部入口进入 */}
            <div
              className="absolute inset-0 flex flex-col"
              style={{ display: activeTabId === SETTINGS_TAB_ID ? 'flex' : 'none' }}
            >
              <SettingsPage />
            </div>
            {/* 文章：选中即挂载（切会话 tab 保持挂载不重加载），清空选中即卸载 */}
            {orderedTabs.map((tab) => (
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
                />
              </div>
            ))}
          </div>
        </section>

        {/* 右侧：伴随面板（会话 tab 与草稿视图显示；开关状态保留，切走按原状态恢复） */}
        {(activeTabId === DRAFT_VIEW_ID || !isSentinelTabId(activeTabId)) && (
          <CompanionPanel workspaceId={companionWorkspaceId} groupId={companionGroupId} />
        )}
      </div>

      {/* 文件历史 Dialog */}
      <FileHistoryPanel />
    </main>
  );
}
