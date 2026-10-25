import type { ReactNode } from 'react';
import { MessageSquare, StickyNote, ListChecks, Database, Archive, Settings } from 'lucide-react';
import { cn } from '@/lib/utils';
import { client } from '@/lib/client';
import feishuLogo from '@/assets/feishu-logo.png';
import {
  useSessionStore,
  isInConversationMode,
  DRAFT_VIEW_ID,
  NOTES_TAB_ID,
  TASKS_TAB_ID,
  DATA_CENTER_TAB_ID,
  ARCHIVE_TAB_ID,
  FEISHU_TAB_ID,
  SETTINGS_TAB_ID,
} from '@/stores/session-store';
import { useUIStore } from '@/stores/ui-store';

interface RailItem {
  id: string;
  title: string;
  icon: ReactNode;
  active: boolean;
  onClick: () => void;
}

export function ActivityRail() {
  const activeTabId = useSessionStore((s) => s.activeTabId);
  const tabs = useSessionStore((s) => s.tabs);
  const prevConversationView = useSessionStore((s) => s.prevConversationView);
  const sessionWindowIds = useSessionStore((s) => s.sessionWindowIds);
  const switchTab = useSessionStore((s) => s.switchTab);
  const openDataCenterTab = useSessionStore((s) => s.openDataCenterTab);
  const openArchiveTab = useSessionStore((s) => s.openArchiveTab);
  const openFeishuTab = useSessionStore((s) => s.openFeishuTab);
  const notesWindowOpen = useSessionStore((s) => s.notesWindowOpen);
  const dataCenterWindowOpen = useSessionStore((s) => s.dataCenterWindowOpen);
  const toggleConversationList = useUIStore((s) => s.toggleConversationList);
  const toggleNotesListHidden = useUIStore((s) => s.toggleNotesListHidden);
  const toggleTasksListHidden = useUIStore((s) => s.toggleTasksListHidden);

  const inConversationMode = isInConversationMode(activeTabId);

  // 整页模式点「对话」的落地目标：切哨兵页前开着的视图（含草稿）仍可用则恢复；视图失效（tab 已关/已弹出）
  // 落最近活跃会话 tab；全部弹出时聚焦最近活跃弹窗，无任何 tab 落草稿（弹出中的 tab 主窗口不可承载：attachment 已 detach 到子窗口）
  const backToConversation = () => {
    const available = tabs.filter((t) => !sessionWindowIds.has(t.conversationId));
    if (available.length === 0) {
      const popped = tabs.filter((t) => sessionWindowIds.has(t.conversationId));
      const target = popped.length > 0
        ? popped.reduce((best, t) => (t.lastActiveAt > best.lastActiveAt ? t : best))
        : null;
      if (target) {
        void client
          .openSessionWindow({ conversationId: target.conversationId, title: target.conversationTitle || '新对话' })
          .catch((err) => console.error('聚焦独立窗口失败:', err));
        return;
      }
      switchTab(DRAFT_VIEW_ID);
      return;
    }
    if (prevConversationView === DRAFT_VIEW_ID) {
      switchTab(DRAFT_VIEW_ID);
      return;
    }
    const prevTab = available.find((t) => t.conversationId === prevConversationView);
    if (prevTab) {
      switchTab(prevTab.conversationId);
      return;
    }
    const landing = available.reduce((best, t) => (t.lastActiveAt > best.lastActiveAt ? t : best));
    switchTab(landing.conversationId);
  };

  const items: RailItem[] = [
    {
      id: 'chat',
      title: '对话',
      icon: <MessageSquare className="w-[18px] h-[18px]" />,
      active: inConversationMode,
      onClick: () => {
        if (inConversationMode) {
          toggleConversationList();
        } else {
          backToConversation();
        }
      },
    },
    {
      id: 'notes',
      title: '笔记',
      icon: <StickyNote className="w-[18px] h-[18px]" />,
      active: activeTabId === NOTES_TAB_ID,
      onClick: () => {
        if (notesWindowOpen) {
          client.openNotesWindow();
          return;
        }
        if (activeTabId === NOTES_TAB_ID) {
          toggleNotesListHidden();
          return;
        }
        switchTab(NOTES_TAB_ID);
      },
    },
    {
      id: 'tasks',
      title: '任务',
      icon: <ListChecks className="w-[18px] h-[18px]" />,
      active: activeTabId === TASKS_TAB_ID,
      onClick: () => {
        if (activeTabId === TASKS_TAB_ID) {
          toggleTasksListHidden();
          return;
        }
        switchTab(TASKS_TAB_ID);
      },
    },
    {
      id: 'data-center',
      title: '数据中心',
      icon: <Database className="w-[18px] h-[18px]" />,
      active: activeTabId === DATA_CENTER_TAB_ID,
      onClick: () => {
        if (dataCenterWindowOpen) {
          client.openDataCenterWindow();
          return;
        }
        openDataCenterTab();
      },
    },
    {
      id: 'archive',
      title: '归档',
      icon: <Archive className="w-[18px] h-[18px]" />,
      active: activeTabId === ARCHIVE_TAB_ID,
      onClick: openArchiveTab,
    },
    {
      id: 'feishu',
      title: '飞书',
      icon: <img src={feishuLogo} alt="飞书" className="w-[18px] h-[18px] rounded-[4px]" />,
      active: activeTabId === FEISHU_TAB_ID,
      onClick: openFeishuTab,
    },
  ];

  return (
    <aside className="w-12 shrink-0 border-r bg-sidebar flex flex-col items-center pt-2 pb-3">
      <nav className="flex flex-col items-center gap-1">
        {items.map((item) => (
          <button
            key={item.id}
            title={item.title}
            onClick={item.onClick}
            className={cn(
              'relative w-9 h-9 rounded-lg grid place-items-center transition-colors',
              item.active
                ? 'bg-primary/10 text-primary'
                : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground',
            )}
          >
            {item.active && (
              <span
                aria-hidden
                className="absolute -left-1.5 top-2 bottom-2 w-[3px] rounded-full bg-primary"
              />
            )}
            {item.icon}
          </button>
        ))}
      </nav>
      <div className="flex-1" />
      <button
        title="设置"
        onClick={() => switchTab(SETTINGS_TAB_ID)}
        className={cn(
          'relative w-9 h-9 rounded-lg grid place-items-center transition-colors',
          activeTabId === SETTINGS_TAB_ID
            ? 'bg-primary/10 text-primary'
            : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground',
        )}
      >
        {activeTabId === SETTINGS_TAB_ID && (
          <span
            aria-hidden
            className="absolute -left-1.5 top-2 bottom-2 w-[3px] rounded-full bg-primary"
          />
        )}
        <Settings className="w-[18px] h-[18px]" />
      </button>
    </aside>
  );
}
