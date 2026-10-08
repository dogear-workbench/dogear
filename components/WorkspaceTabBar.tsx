/**
 * 工作区多会话 Tab 栏
 *
 * 职责：
 * - 渲染活跃会话标签页（来自 session-store），按容器宽度弹性收纳：
 *   超出可见数的 tab 收进右端「…」溢出菜单，任何宽度不出横向滚动条
 * - 点击 Tab：纯切换焦点（跨工作区的左右面板同步由 conversation-store 焦点联动处理）；
 *   溢出菜单项点击 = switchTab，排序置顶逻辑保证弹回可视区
 * - 关闭 Tab：释放后端 Query 会话（closeQueryBasedSession），再从 UI 移除
 * - 显示 StatusPulse 指示运行/等待确认状态，「…」按钮在溢出区有未读时显示绿点
 * - 右键菜单：弹出到独立窗口、关闭标签页、关闭其他标签页；hover 快捷入口：弹出、关闭
 * - 右组哨兵 tabs 图标化（笔记/数据中心/归档/飞书/网页AI），title tooltip 承担命名
 *
 * 不负责：
 * - AgentChat 渲染（由调用方控制）
 * - 对话创建（由对话列表处理）
 */

import { useMemo } from 'react';
import { ExternalLink, X, StickyNote, Database, Newspaper, Archive, Ellipsis } from 'lucide-react';
import { toast } from 'sonner';
import { client } from '@/lib/client';
import { cn } from '@/lib/utils';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { StatusPulse } from '@/components/StatusPulse';
import { useSessionStore, type SessionTab, NOTES_TAB_ID, DATA_CENTER_TAB_ID, ARTICLE_TAB_ID, ARCHIVE_TAB_ID, FEISHU_TAB_ID, WEB_AI_TAB_ID } from '@/stores/session-store';
import { useConversationStore } from '@/stores/conversation-store';
import { useArticleStore } from '@/stores/article-store';
import { useContainerWidth } from '@/hooks/use-container-width';
import type { Conversation } from '@/types/electron-api';
import feishuLogo from '@/assets/feishu-logo.png';
import { WebAiSiteMenu } from '@/components/webai/WebAiSiteMenu';

/** 闲置淡化阈值：lastActiveAt 超过该时长且非运行/非未读的 tab 淡化显示 */
const IDLE_FADE_MS = 24 * 60 * 60 * 1000;
/** tab 最小宽度：低于它就收进溢出菜单（预算按此值计算，压缩模式实际可被 flex 压得更窄） */
const MIN_TAB_WIDTH = 120;
/** 溢出按钮在左组容器中占用的宽度预算 */
const OVERFLOW_BUTTON_WIDTH = 40;

interface TabVisualState {
  isActive: boolean;
  isRunning: boolean;
  isPending: boolean;
  isUnread: boolean;
  isSubSession: boolean;
  isIdle: boolean;
}

function SessionTabItem({
  tab,
  title,
  canPopOut,
  hasOthers,
  visual,
  onSelect,
  onClose,
  onCloseOthers,
  onPopOut,
}: {
  tab: SessionTab;
  title: string;
  canPopOut: boolean;
  hasOthers: boolean;
  visual: TabVisualState;
  onSelect: (tab: SessionTab) => void;
  onClose: (tab: SessionTab) => void;
  onCloseOthers: (tab: SessionTab) => void;
  onPopOut: (tab: SessionTab) => void;
}) {
  const showPulse = visual.isRunning;
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          className={cn(
            'group flex items-center gap-1.5 px-3 py-2 text-sm cursor-pointer border-r max-w-[200px] flex-1 min-w-0',
            visual.isActive ? 'bg-background font-medium'
              : visual.isUnread ? 'hover:bg-muted/50 font-medium text-foreground'
              : 'hover:bg-muted/50 text-muted-foreground',
            visual.isIdle && 'opacity-60',
          )}
          onClick={() => onSelect(tab)}
        >
          {showPulse && <StatusPulse isPending={visual.isPending} size="sm" />}
          {visual.isUnread && !showPulse && (
            <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" title="未读" />
          )}
          {visual.isSubSession && (
            <span className="text-xs leading-none text-muted-foreground shrink-0" title="子会话">↳</span>
          )}
          <span className="truncate">{title}</span>
          {showPulse && visual.isPending && (
            <span className="text-[10px] text-blue-600 bg-blue-50 px-1 rounded shrink-0">等待确认</span>
          )}
          {canPopOut && (
            <button
              className="ml-0.5 p-0.5 rounded hover:bg-muted shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
              title="弹出为独立窗口"
              onClick={(e) => {
                e.stopPropagation();
                onPopOut(tab);
              }}
            >
              <ExternalLink className="w-3 h-3" />
            </button>
          )}
          <button
            className="ml-0.5 p-0.5 rounded hover:bg-muted shrink-0"
            title="关闭标签页"
            onClick={(e) => {
              e.stopPropagation();
              onClose(tab);
            }}
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onClick={() => onPopOut(tab)} disabled={!canPopOut}>
          <ExternalLink className="w-3.5 h-3.5 mr-2" />
          弹出到独立窗口
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={() => onClose(tab)}>
          <X className="w-3.5 h-3.5 mr-2" />
          关闭标签页
        </ContextMenuItem>
        <ContextMenuItem onClick={() => onCloseOthers(tab)} disabled={!hasOthers}>
          关闭其他标签页
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

function OverflowTabMenuItem({
  tab,
  title,
  isRunning,
  isPending,
  isUnread,
  isSubSession,
  onSelect,
  onClose,
}: {
  tab: SessionTab;
  title: string;
  isRunning: boolean;
  isPending: boolean;
  isUnread: boolean;
  isSubSession: boolean;
  onSelect: (tab: SessionTab) => void;
  onClose: (tab: SessionTab) => void;
}) {
  return (
    <DropdownMenuItem className="group pr-1.5" onSelect={() => onSelect(tab)}>
      <span className="w-3 h-3 flex items-center justify-center shrink-0">
        {isRunning && <StatusPulse isPending={isPending} size="sm" />}
        {!isRunning && isUnread && <span className="w-2 h-2 rounded-full bg-emerald-500" title="未读" />}
      </span>
      {isSubSession && (
        <span className="text-xs leading-none text-muted-foreground shrink-0" title="子会话">↳</span>
      )}
      <span className="truncate flex-1 min-w-0" title={title}>{title}</span>
      <button
        className="p-0.5 rounded hover:bg-muted shrink-0 opacity-0 group-hover:opacity-100"
        title="关闭标签页"
        onClick={(e) => {
          e.stopPropagation();
          onClose(tab);
        }}
      >
        <X className="size-3" />
      </button>
    </DropdownMenuItem>
  );
}

export function WorkspaceTabBar() {
  const allTabs = useSessionStore((s) => s.tabs);
  const activeTabId = useSessionStore((s) => s.activeTabId);
  const sessionWindowIds = useSessionStore((s) => s.sessionWindowIds);
  const switchTab = useSessionStore((s) => s.switchTab);
  const closeTab = useSessionStore((s) => s.closeTab);
  const addSessionWindow = useSessionStore((s) => s.addSessionWindow);
  const notesWindowOpen = useSessionStore((s) => s.notesWindowOpen);
  const dataCenterTabOpen = useSessionStore((s) => s.dataCenterTabOpen);
  const dataCenterWindowOpen = useSessionStore((s) => s.dataCenterWindowOpen);
  const closeDataCenterTab = useSessionStore((s) => s.closeDataCenterTab);
  const archiveTabOpen = useSessionStore((s) => s.archiveTabOpen);
  const closeArchiveTab = useSessionStore((s) => s.closeArchiveTab);
  const feishuTabOpen = useSessionStore((s) => s.feishuTabOpen);
  const closeFeishuTab = useSessionStore((s) => s.closeFeishuTab);
  const webAiTabOpen = useSessionStore((s) => s.webAiTabOpen);
  const closeWebAiTab = useSessionStore((s) => s.closeWebAiTab);
  const selectedArticle = useArticleStore((s) => s.selectedArticle);
  const clearSelectedArticle = useArticleStore((s) => s.clearSelectedArticle);

  const pendingActionIds = useConversationStore((s) => s.pendingActionConversationIds);
  const runningConversationIds = useConversationStore((s) => s.runningConversationIds);
  const byWorkspace = useConversationStore((s) => s.byWorkspace);
  const personalConversations = useConversationStore((s) => s.personalConversations);

  const [tabsContainerRef, tabsContainerWidth] = useContainerWidth<HTMLDivElement>();

  // 过滤掉已弹到独立窗口的 Tab（保持 AgentChat 挂载但不显示标签头）
  const tabs = useMemo(
    () => allTabs.filter((t) => !sessionWindowIds.has(t.conversationId)),
    [allTabs, sessionWindowIds],
  );

  // tabs 跨工作区保留，会话数据从所有分片（含 personal）统一查
  const convById = useMemo(() => {
    const map = new Map<string, Conversation>();
    for (const slice of Object.values(byWorkspace)) {
      for (const c of slice.conversations) map.set(c.id, c);
    }
    for (const c of personalConversations) map.set(c.id, c);
    return map;
  }, [byWorkspace, personalConversations]);

  /** 同派遣树主子相邻（DFS：主在前子随后，组间保持 store 排序）；仅派生展示顺序，不回写 store */
  const displayTabs = useMemo(() => {
    const childTabsByParentSession = new Map<string, SessionTab[]>();
    for (const tab of tabs) {
      const meta = convById.get(tab.conversationId)?.contractMetadata;
      if (meta?.createdBy !== 'agent' || !meta.parentSessionId) continue;
      const list = childTabsByParentSession.get(meta.parentSessionId) ?? [];
      list.push(tab);
      childTabsByParentSession.set(meta.parentSessionId, list);
    }
    const sessionIdByConvId = new Map<string, string | null | undefined>();
    for (const tab of tabs) {
      sessionIdByConvId.set(tab.conversationId, convById.get(tab.conversationId)?.sessionId);
    }
    const emitted = new Set<string>();
    const result: SessionTab[] = [];
    const emit = (tab: SessionTab) => {
      if (emitted.has(tab.conversationId)) return;
      emitted.add(tab.conversationId);
      result.push(tab);
      const children = childTabsByParentSession.get(sessionIdByConvId.get(tab.conversationId) ?? '');
      if (children) for (const child of children) emit(child);
    };
    for (const tab of tabs) emit(tab);
    return result;
  }, [tabs, convById]);

  /** 可见数 = 容器宽度预算下的弹性计算：全部放得下则全显，否则按 min 宽容纳最多数量（至少 1），剩余进溢出菜单 */
  const visibleCount = useMemo(() => {
    const total = displayTabs.length;
    if (tabsContainerWidth === 0 || total === 0) return total;
    if (total * MIN_TAB_WIDTH <= tabsContainerWidth) return total;
    return Math.max(1, Math.floor((tabsContainerWidth - OVERFLOW_BUTTON_WIDTH) / MIN_TAB_WIDTH));
  }, [tabsContainerWidth, displayTabs.length]);

  const visibleTabs = displayTabs.slice(0, visibleCount);
  const overflowTabs = displayTabs.slice(visibleCount);
  const flexible = overflowTabs.length > 0;
  const overflowHasUnread = overflowTabs.some((t) => convById.get(t.conversationId)?.unread);

  /** 标题实时取 conversation-store（覆盖自动起名/手动重命名）；跨工作区或已删除时回退快照 */
  const resolveTabTitle = (tab: SessionTab): string => {
    const live = convById.get(tab.conversationId);
    if (live) return live.title || '新对话';
    return tab.conversationTitle;
  };

  /** Tab 点击：纯切换焦点，跨工作区的左右面板同步由 conversation-store 焦点联动接管 */
  const handleTabClick = (tab: SessionTab) => {
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
      title: resolveTabTitle(tab),
    });
    // 标记为独立窗口，AgentChat 保持挂载以便 attachment 平滑过渡，
    // 直到 sessionWindowClosed 事件通知窗口关闭后才安全关闭标签页
    addSessionWindow(tab.conversationId);
  };

  const buildVisual = (tab: SessionTab): TabVisualState => {
    const conv = convById.get(tab.conversationId);
    const isRunning = runningConversationIds.has(tab.conversationId);
    const isPending = pendingActionIds.has(tab.conversationId);
    const isUnread = !!conv?.unread;
    return {
      isActive: activeTabId === tab.conversationId,
      isRunning,
      isPending,
      isUnread,
      isSubSession: conv?.contractMetadata?.createdBy === 'agent',
      isIdle: !isRunning && !isPending && !isUnread && Date.now() - tab.lastActiveAt > IDLE_FADE_MS,
    };
  };

  const showSentinelGroup =
    !notesWindowOpen ||
    (dataCenterTabOpen && !dataCenterWindowOpen) ||
    selectedArticle !== null ||
    archiveTabOpen ||
    feishuTabOpen ||
    webAiTabOpen;

  return (
    <div className="flex items-stretch border-b bg-sidebar">
      {/* 左组：会话 tabs 弹性收纳（均分 + max-w 封顶，永不溢出容器），溢出收进「…」菜单 */}
      <div ref={tabsContainerRef} className="flex flex-1 min-w-0 items-center overflow-hidden">
        {visibleTabs.map((tab) => (
          <SessionTabItem
            key={tab.conversationId}
            tab={tab}
            title={resolveTabTitle(tab)}
            canPopOut={!runningConversationIds.has(tab.conversationId)}
            hasOthers={tabs.length > 1}
            visual={buildVisual(tab)}
            onSelect={handleTabClick}
            onClose={(t) => void closeTabInternal(t)}
            onCloseOthers={handleCloseOthers}
            onPopOut={popOutInternal}
          />
        ))}
        {flexible && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className="relative flex items-center px-2 py-2 shrink-0 cursor-pointer outline-none border-r text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                title="更多标签页"
              >
                <Ellipsis className="w-4 h-4" />
                {overflowHasUnread && (
                  <span className="absolute top-0.5 right-0.5 w-2 h-2 rounded-full bg-emerald-500" title="溢出标签页有未读" />
                )}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="max-w-[280px]">
              {overflowTabs.map((tab) => {
                const conv = convById.get(tab.conversationId);
                return (
                  <OverflowTabMenuItem
                    key={tab.conversationId}
                    tab={tab}
                    title={resolveTabTitle(tab)}
                    isRunning={runningConversationIds.has(tab.conversationId)}
                    isPending={pendingActionIds.has(tab.conversationId)}
                    isUnread={!!conv?.unread}
                    isSubSession={conv?.contractMetadata?.createdBy === 'agent'}
                    onSelect={handleTabClick}
                    onClose={(t) => void closeTabInternal(t)}
                  />
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      {/* 右组：哨兵 tabs 图标化固定最右，弹出中的哨兵隐藏 */}
      {showSentinelGroup && (
        <div className="flex items-center shrink-0">
          {!notesWindowOpen && (
            <div
              onClick={() => switchTab(NOTES_TAB_ID)}
              className={cn(
                'group flex items-center gap-1.5 px-3 py-2 text-sm cursor-pointer border-r shrink-0',
                activeTabId === NOTES_TAB_ID ? 'bg-background font-medium' : 'hover:bg-muted/50 text-muted-foreground',
              )}
              title="笔记"
            >
              <StickyNote className="w-3.5 h-3.5" />
              <button
                className="ml-0.5 p-0.5 rounded hover:bg-muted shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                title="弹出为独立窗口"
                onClick={(e) => {
                  e.stopPropagation();
                  client.openNotesWindow();
                }}
              >
                <ExternalLink className="w-3 h-3" />
              </button>
            </div>
          )}
          {dataCenterTabOpen && !dataCenterWindowOpen && (
            <div
              onClick={() => switchTab(DATA_CENTER_TAB_ID)}
              className={cn(
                'group flex items-center gap-1.5 px-3 py-2 text-sm cursor-pointer border-r shrink-0',
                activeTabId === DATA_CENTER_TAB_ID ? 'bg-background font-medium' : 'hover:bg-muted/50 text-muted-foreground',
              )}
              title="数据中心"
            >
              <Database className="w-3.5 h-3.5" />
              <button
                className="ml-0.5 p-0.5 rounded hover:bg-muted shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                title="弹出为独立窗口"
                onClick={(e) => {
                  e.stopPropagation();
                  client.openDataCenterWindow();
                }}
              >
                <ExternalLink className="w-3 h-3" />
              </button>
              <button
                className="ml-0.5 p-0.5 rounded hover:bg-muted shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                title="关闭数据中心"
                onClick={(e) => {
                  e.stopPropagation();
                  closeDataCenterTab();
                }}
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          )}
          {/* 归档：可开关 Tab，不落盘，无弹出窗口 */}
          {archiveTabOpen && (
            <div
              onClick={() => switchTab(ARCHIVE_TAB_ID)}
              className={cn(
                'group flex items-center gap-1.5 px-3 py-2 text-sm cursor-pointer border-r shrink-0',
                activeTabId === ARCHIVE_TAB_ID ? 'bg-background font-medium' : 'hover:bg-muted/50 text-muted-foreground',
              )}
              title="归档"
            >
              <Archive className="w-3.5 h-3.5" />
              <button
                className="ml-0.5 p-0.5 rounded hover:bg-muted shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                title="关闭归档"
                onClick={(e) => {
                  e.stopPropagation();
                  closeArchiveTab();
                }}
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          )}
          {/* 文章：有选中文章才显示，关闭即清空选中；保留标题（内容语义） */}
          {selectedArticle !== null && (
            <div
              onClick={() => switchTab(ARTICLE_TAB_ID)}
              className={cn(
                'group flex items-center gap-1.5 px-3 py-2 text-sm cursor-pointer border-r shrink-0 max-w-[200px]',
                activeTabId === ARTICLE_TAB_ID ? 'bg-background font-medium' : 'hover:bg-muted/50 text-muted-foreground',
              )}
              title={selectedArticle.title}
            >
              <Newspaper className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">{selectedArticle.title}</span>
              <button
                className="ml-0.5 p-0.5 rounded hover:bg-muted shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                title="关闭文章"
                onClick={(e) => {
                  e.stopPropagation();
                  clearSelectedArticle();
                }}
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          )}
          {/* 飞书：可开关 Tab，不落盘，无弹出窗口 */}
          {feishuTabOpen && (
            <div
              onClick={() => switchTab(FEISHU_TAB_ID)}
              className={cn(
                'group flex items-center gap-1.5 px-3 py-2 text-sm cursor-pointer border-r shrink-0',
                activeTabId === FEISHU_TAB_ID ? 'bg-background font-medium' : 'hover:bg-muted/50 text-muted-foreground',
              )}
              title="飞书"
            >
              <img src={feishuLogo} alt="飞书" className="w-3.5 h-3.5 rounded-[3px]" />
              <button
                className="ml-0.5 p-0.5 rounded hover:bg-muted shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                title="关闭飞书"
                onClick={(e) => {
                  e.stopPropagation();
                  closeFeishuTab();
                }}
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          )}
          {/* 网页 AI：可开关 Tab，不落盘，无弹出窗口；纯图标 + 站点切换箭头弹菜单，关闭同时销毁主进程 embedded tab（分区登录态保留） */}
          {webAiTabOpen && (
            <div
              onClick={() => switchTab(WEB_AI_TAB_ID)}
              className={cn(
                'group flex items-center gap-1.5 px-3 py-2 text-sm cursor-pointer border-r shrink-0',
                activeTabId === WEB_AI_TAB_ID ? 'bg-background font-medium' : 'hover:bg-muted/50 text-muted-foreground',
              )}
              title="网页 AI"
            >
              <WebAiSiteMenu />
              <button
                className="ml-0.5 p-0.5 rounded hover:bg-muted shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                title="关闭网页 AI"
                onClick={(e) => {
                  e.stopPropagation();
                  client.closeWebAiTab().catch((err) => console.error('关闭网页 AI 失败:', err));
                  closeWebAiTab();
                }}
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
