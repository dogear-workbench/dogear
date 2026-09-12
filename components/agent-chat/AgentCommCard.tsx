import { useEffect, useState } from 'react';
import { ArrowRight, ChevronUp, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { client } from '@/lib/client';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { MarkdownRenderer } from '@/components/MarkdownRenderer';
import { useConversationStore } from '@/stores/conversation-store';
import type { Conversation } from '@/components/ConversationList';
import { openOrFocusConversation } from '@/components/conversation-list/utils';
import { useWorkspaceId } from './workspace-id-context';
import { INJECTION_TAG_STYLES } from './injection-tags';

export function CommCollapseBar({ onCollapse }: { onCollapse: () => void }) {
  return (
    <button
      type="button"
      onClick={onCollapse}
      title="收起"
      className="mt-1 w-full flex items-center justify-center gap-1 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/50 rounded transition-colors cursor-pointer"
    >
      收起
      <ChevronUp className="w-3 h-3" />
    </button>
  );
}

// peerSessionId → conversation：先查本地会话 store，未命中再拉工作区会话列表（同 ToolBlock 打开子会话的反查口径）
function usePeerConversation(peerSessionId: string): Conversation | undefined {
  const workspaceId = useWorkspaceId();
  const [conv, setConv] = useState<Conversation | undefined>(() => {
    return useConversationStore.getState().conversations.find((c) => c.session_id === peerSessionId);
  });
  useEffect(() => {
    let cancelled = false;
    const local = useConversationStore.getState().conversations.find((c) => c.session_id === peerSessionId);
    if (local) {
      setConv(local);
      return;
    }
    if (!workspaceId) return;
    void client.getByWorkspaceId({ workspaceId })
      .then((result) => {
        if (cancelled) return;
        const found = (result.conversations ?? []).find((c) => c.session_id === peerSessionId);
        if (found) setConv(found);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [peerSessionId, workspaceId]);
  return conv;
}

// 会话跳转节点口径与 NotificationCenter 一致：topic:{groupId}:{id}
export function jumpToPeerConversation(conv: Conversation): void {
  openOrFocusConversation(conv, conv.groupId ? `topic:${conv.groupId}:${conv.id}` : undefined);
}

// 会话名可点跳转：反查不到 conversation 时降级为纯文本
export function SessionPeerLink({ sessionId, displayName }: { sessionId?: string; displayName: string }) {
  const conv = usePeerConversation(sessionId ?? '');
  if (!sessionId || !conv) return <span className="break-all">{displayName}</span>;
  return (
    <button
      type="button"
      onClick={() => jumpToPeerConversation(conv)}
      title="打开会话"
      className="text-left break-all hover:underline cursor-pointer"
    >
      {displayName}
    </button>
  );
}

function toOutputText(toolOutput: unknown): string {
  if (typeof toolOutput === 'string') return toolOutput;
  return toolOutput != null ? JSON.stringify(toolOutput, null, 2) : '';
}

/** agent↔agent 发出通讯卡（dogear__SendMessage 摘壳）：一行收起「→ 发给 @会话名」，仅手动展开 */
export function AgentCommCard({ toolInput, toolOutput, isError, timestamp }: {
  toolInput?: Record<string, any>;
  toolOutput?: any;
  isError?: boolean;
  timestamp?: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const message = typeof toolInput?.message === 'string' ? toolInput.message : '';
  const toSessionId = typeof toolInput?.toSessionId === 'string' ? toolInput.toSessionId : '';
  const delivery = toolInput?.options?.delivery === true;
  const running = toolOutput === undefined;
  const conv = usePeerConversation(toSessionId);
  const peerName = conv?.title;
  const styles = INJECTION_TAG_STYLES[delivery ? 'delivery' : 'reply'];
  const preview = (isError ? toOutputText(toolOutput).split('\n')[0] : message).replace(/\s+/g, ' ').trim();

  return (
    <div className={cn('w-full my-2 rounded-r-lg border-l-[3px] px-3 py-2', styles.bar, styles.card)}>
      <Collapsible open={expanded} onOpenChange={setExpanded}>
        <CollapsibleTrigger className="flex items-center gap-1.5 w-full text-xs text-muted-foreground cursor-pointer">
          <ArrowRight className="w-3 h-3 flex-shrink-0" />
          <span className="flex-shrink-0">发给</span>
          <span
            className="font-medium truncate max-w-[160px] text-foreground/80 flex-shrink-0"
            title={peerName ? undefined : toSessionId}
          >
            @{peerName ?? `${toSessionId.slice(0, 8)}…`}
          </span>
          <span className={cn('px-1.5 py-0.5 rounded text-[10px] flex-shrink-0', styles.badge)}>
            {delivery ? '交付' : '消息'}
          </span>
          {running && (
            <span className="inline-flex items-center gap-1 text-[10px] text-sky-600 dark:text-sky-400 flex-shrink-0">
              <Loader2 className="w-3 h-3 animate-spin" />
              发送中
            </span>
          )}
          {isError && (
            <span className="px-1.5 py-0.5 rounded text-[10px] bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300 flex-shrink-0">
              发送失败
            </span>
          )}
          {preview && <span className="truncate flex-1 min-w-0 text-foreground/70">{preview}</span>}
          {typeof timestamp === 'number' && (
            <span className="flex-shrink-0 text-muted-foreground/60">{new Date(timestamp).toLocaleTimeString()}</span>
          )}
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="mt-1 pt-1 border-t border-border/40">
            <div className="mb-1 flex items-start gap-1.5 text-xs text-muted-foreground">
              <ArrowRight className="w-3 h-3 flex-shrink-0 mt-0.5" />
              <span className="break-all">
                发给 @{peerName
                  ? <SessionPeerLink sessionId={toSessionId} displayName={peerName} />
                  : toSessionId}
                {peerName && ` · ${toSessionId}`}
              </span>
            </div>
            {message ? (
              <MarkdownRenderer content={message} className="text-xs" />
            ) : !isError ? (
              <div className="text-xs text-muted-foreground/70">（无消息内容）</div>
            ) : null}
            {isError && (
              <pre className="mt-1.5 text-xs text-red-600 dark:text-red-400 whitespace-pre-wrap break-all max-h-32 overflow-y-auto">
                {toOutputText(toolOutput)}
              </pre>
            )}
            <CommCollapseBar onCollapse={() => setExpanded(false)} />
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
