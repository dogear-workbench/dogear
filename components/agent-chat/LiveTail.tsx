import { memo, Fragment } from 'react';
import type { PendingState } from './hooks/usePendingState';
import { useTranscriptLiveTail, type TranscriptStoreApi } from './hooks/useTranscriptState';
import { MessageItem } from './MessageItem';
import { StreamingIndicator } from './StreamingIndicator';
import { TodoListBlock } from './TodoListBlock';

interface LiveTailProps {
  transcriptStore: TranscriptStoreApi;
  pendingState: PendingState;
  pendingCount: number;
  fallbackLastBlockType?: string;
  awaitCount: number;
  doneCount: number;
  issueCount: number;
  awaitingDelivery?: boolean;
  onAbortWait?: () => void;
  onFork?: (assistantSdkUuid: string) => void;
  onPermissionResolved: (requestId: string, behavior: 'allow' | 'deny' | 'allow_session') => void;
  onAskUserResolved: (requestId: string, answers: Record<string, string>) => void;
  onInterrupt: () => void;
  searchQuery?: string;
  activeMatchId: string | null;
  readOnly: boolean;
  sessionId: string | null;
  isAgentConversation: boolean;
  taskTodos: Array<{ content: string; activeForm: string; status: 'pending' | 'in_progress' | 'completed' }>;
  lastTaskMessageId: string | null;
}

export const LiveTail = memo(function LiveTail({
  transcriptStore,
  pendingState,
  pendingCount,
  fallbackLastBlockType,
  awaitCount,
  doneCount,
  issueCount,
  awaitingDelivery,
  onAbortWait,
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
}: LiveTailProps) {
  const liveTail = useTranscriptLiveTail(transcriptStore);
  const lastBlockType = liveTail.length
    ? liveTail[liveTail.length - 1].contentBlocks?.slice(-1)[0]?.type
    : fallbackLastBlockType;

  return (
    <>
      {liveTail.length > 0 && (
        <section className="agent-turn">
          {liveTail.map((message) => {
            if (!message.id) return null;
            return (
              <Fragment key={message.id}>
                <MessageItem
                  message={message}
                  messageId={message.id}
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
                {lastTaskMessageId === message.id && <TodoListBlock todos={taskTodos} />}
              </Fragment>
            );
          })}
        </section>
      )}
      <StreamingIndicator
        pendingState={pendingState}
        pendingCount={pendingCount}
        lastBlockType={lastBlockType}
        awaitCount={awaitCount}
        doneCount={doneCount}
        issueCount={issueCount}
        awaitingDelivery={awaitingDelivery}
        onAbortWait={onAbortWait}
      />
    </>
  );
});
