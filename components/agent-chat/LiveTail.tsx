import { memo } from 'react';
import type { PendingState } from './hooks/usePendingState';
import { useTranscriptLiveTail, type TranscriptStoreApi } from './hooks/useTranscriptState';
import { MessageItem } from './MessageItem';
import { StreamingIndicator } from './StreamingIndicator';

interface LiveTailProps {
  transcriptStore: TranscriptStoreApi;
  pendingState: PendingState;
  pendingCount: number;
  fallbackLastBlockType?: string;
  onFork?: (assistantSdkUuid: string) => void;
  onPermissionResolved: (requestId: string, behavior: 'allow' | 'deny' | 'allow_session') => void;
  onAskUserResolved: (requestId: string, answers: Record<string, string>) => void;
  onInterrupt: () => void;
  searchQuery?: string;
  activeMatchId: string | null;
  activeBlockMatchCount?: number;
  readOnly: boolean;
  sessionId: string | null;
  isAgentConversation: boolean;
}

export const LiveTail = memo(function LiveTail({
  transcriptStore,
  pendingState,
  pendingCount,
  fallbackLastBlockType,
  onFork,
  onPermissionResolved,
  onAskUserResolved,
  onInterrupt,
  searchQuery,
  activeMatchId,
  activeBlockMatchCount,
  readOnly,
  sessionId,
  isAgentConversation,
}: LiveTailProps) {
  const liveTail = useTranscriptLiveTail(transcriptStore);
  const lastBlock = liveTail.length
    ? liveTail[liveTail.length - 1].contentBlocks?.slice(-1)[0]
    : undefined;
  const lastBlockType = lastBlock?.type ?? fallbackLastBlockType;
  const lastToolName = lastBlock?.type === 'tool_use' ? lastBlock.toolName : undefined;

  return (
    <>
      {liveTail.length > 0 && (
        <section className="agent-turn">
          {liveTail.map((message) => {
            if (!message.id) return null;
            return (
              <MessageItem
                key={message.id}
                message={message}
                messageId={message.id}
                onFork={readOnly ? undefined : onFork}
                sessionId={sessionId}
                onPermissionResolved={onPermissionResolved}
                onAskUserResolved={onAskUserResolved}
                onInterrupt={onInterrupt}
                searchQuery={searchQuery}
                activeMatchId={activeMatchId}
                activeBlockMatchCount={activeBlockMatchCount}
                isAgentConversation={isAgentConversation}
                readOnly={readOnly}
              />
            );
          })}
        </section>
      )}
      <StreamingIndicator
        pendingState={pendingState}
        pendingCount={pendingCount}
        lastBlockType={lastBlockType}
        lastToolName={lastToolName}
      />
    </>
  );
});
