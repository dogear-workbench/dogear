import { memo, Fragment } from 'react';
import type { Message } from './types';
import type { Turn } from './turns';
import { MessageItem } from './MessageItem';
import { CollapsedHistoryBanner } from './CollapsedHistoryBanner';
import { CollapseControlBar } from './CollapseControlBar';
import { TodoListBlock } from './TodoListBlock';

interface StableHistoryProps {
  turns: Turn[];
  messagesById: Map<string, Message>;
  hasCompactHistory: boolean;
  collapsed: boolean;
  compactBoundaryCount: number;
  onExpandHistory: () => void;
  onCollapseHistory: () => void;
  onFork?: (assistantSdkUuid: string) => void;
  onPermissionResolved: (requestId: string, behavior: 'allow' | 'deny' | 'allow_session') => void;
  onAskUserResolved: (requestId: string, answers: Record<string, string>) => void;
  onInterrupt: () => void;
  searchQuery?: string;
  activeMatchId: string | null;
  readOnly: boolean;
  sessionId: string | null;
  isAgentConversation: boolean;
  taskTodos: Array<{ content: string; activeForm: string; status: string }>;
  lastTaskMessageId: string | null;
}

export const StableHistory = memo(function StableHistory({
  turns,
  messagesById,
  hasCompactHistory,
  collapsed,
  compactBoundaryCount,
  onExpandHistory,
  onCollapseHistory,
  onFork,
  onPermissionResolved,
  onAskUserResolved,
  onInterrupt,
  searchQuery,
  activeMatchId,
  readOnly,
  sessionId,
  isAgentConversation,
  taskTodos,
  lastTaskMessageId,
}: StableHistoryProps) {
  return (
    <>
      {hasCompactHistory && (collapsed ? (
        <CollapsedHistoryBanner count={compactBoundaryCount} onExpand={onExpandHistory} />
      ) : (
        <CollapseControlBar count={compactBoundaryCount} onCollapse={onCollapseHistory} />
      ))}
      {turns.map((turn) => {
        return (
          <section key={turn.turnId} className="agent-turn">
            {turn.memberIds.map((messageId) => {
              const message = messagesById.get(messageId);
              if (!message) return null;
              return (
                <Fragment key={messageId}>
                  <MessageItem
                    message={message}
                    messageId={messageId}
                    onFork={readOnly ? undefined : onFork}
                    sessionId={sessionId}
                    onPermissionResolved={onPermissionResolved}
                    onAskUserResolved={onAskUserResolved}
                    onInterrupt={onInterrupt}
                    searchQuery={searchQuery}
                    activeMatchId={activeMatchId}
                    isAgentConversation={isAgentConversation}
                    readOnly={readOnly}
                  />
                  {lastTaskMessageId === messageId && <TodoListBlock todos={taskTodos} />}
                </Fragment>
              );
            })}
          </section>
        );
      })}
    </>
  );
});
