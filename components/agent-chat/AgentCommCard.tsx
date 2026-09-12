import { useEffect, useState } from 'react';
import { ArrowRight, ChevronUp, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { client } from '@/lib/client';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { MarkdownRenderer } from '@/components/MarkdownRenderer';
import { useConversationStore } from '@/stores/conversation-store';
import { useWorkspaceId } from './workspace-id-context';
import { INJECTION_TAG_STYLES } from './injection-tags';

export function CommCollapseButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title="收起"
      className="p-0.5 rounded text-muted-foreground/50 hover:text-foreground hover:bg-muted/60 transition-colors cursor-pointer"
    >
      <ChevronUp className="w-3.5 h-3.5" />
    </button>
  );
}

// toSessionId → 会话标题：先查本地会话 store，未命中再拉工作区会话列表（同 ToolBlock 打开子会话的反查口径）
function usePeerConversationName(peerSessionId: string): string | undefined {
  const workspaceId = useWorkspaceId();
  const [name, setName] = useState<string | undefined>(() => {
    return useConversationStore.getState().conversations.find((c) => c.session_id === peerSessionId)?.title;
  });
  useEffect(() => {
    let cancelled = false;
    const local = useConversationStore.getState().conversations.find((c) => c.session_id === peerSessionId);
    if (local?.title) {
      setName(local.title);
      return;
    }
    if (!workspaceId) return;
    void client.getByWorkspaceId({ workspaceId })
      .then((result) => {
        if (cancelled) return;
        const title = (result.conversations ?? []).find((c) => c.session_id === peerSessionId)?.title;
        if (title) setName(title);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [peerSessionId, workspaceId]);
  return name;
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
  const peerName = usePeerConversationName(toSessionId);
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
            <div className="flex justify-end">
              <CommCollapseButton onClick={() => setExpanded(false)} />
            </div>
            {message ? (
              <MarkdownRenderer content={message} className="text-sm" />
            ) : !isError ? (
              <div className="text-xs text-muted-foreground/70">（无消息内容）</div>
            ) : null}
            {isError && (
              <pre className="mt-1.5 text-xs text-red-600 dark:text-red-400 whitespace-pre-wrap break-all max-h-32 overflow-y-auto">
                {toOutputText(toolOutput)}
              </pre>
            )}
            <div className="flex justify-end">
              <CommCollapseButton onClick={() => setExpanded(false)} />
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
