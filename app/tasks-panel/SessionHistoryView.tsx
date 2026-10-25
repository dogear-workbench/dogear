import { useEffect, useState } from 'react';
import { AgentChat } from '@/components/agent-chat/AgentChat';
import { CompanionPanel } from '@/components/companion/CompanionPanel';
import { client } from '@/lib/client';
import { TASKS_TAB_ID, useSessionStore } from '@/stores/session-store';
import type { TasksPanelHistoryView } from '@/stores/tasks-panel-store';
import type { Conversation } from '@/types/electron-api';

interface Props {
  view: TasksPanelHistoryView;
}

/** 右栏会话历史：与主界面打开会话同构（AgentChat + CompanionPanel 并排），切回详情靠左栏选择 */
export function SessionHistoryView({ view }: Props) {
  const visible = useSessionStore((s) => s.activeTabId === TASKS_TAB_ID);
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setConversation(null);
    setLoadError(null);
    client.getById({ conversationId: view.conversationId, workspaceId: view.workspaceId })
      .then((r) => {
        if (cancelled) return;
        if (r.conversation) setConversation(r.conversation);
        else setLoadError(r.error ?? '会话不存在或已被删除');
      })
      .catch((e) => {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : String(e));
      });
    return () => { cancelled = true; };
  }, [view.conversationId, view.workspaceId]);

  // 面板查看会话即视为全局焦点：终态未读不误标、关联任务通知联动已读
  useEffect(() => {
    if (!visible) return;
    void client.setFocusedConversation({ conversationId: view.conversationId, workspaceId: view.workspaceId }).catch(() => {});
  }, [visible, view.conversationId, view.workspaceId]);

  return (
    <div className="flex-1 flex min-h-0">
      {loadError ? (
        <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">{loadError}</div>
      ) : (
        <>
          <div className="flex-1 min-w-0 min-h-0">
            <AgentChat
              key={view.conversationId}
              conversationIdOverride={view.conversationId}
              workspaceId={view.workspaceId}
              visible={visible}
              panelActive={visible}
            />
          </div>
          <CompanionPanel workspaceId={view.workspaceId} groupId={conversation?.groupId ?? null} />
        </>
      )}
    </div>
  );
}
