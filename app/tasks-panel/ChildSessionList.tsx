import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { client } from '@/lib/client';
import { cn } from '@/lib/utils';
import { useConversationStore } from '@/stores/conversation-store';
import { getConversationTitle } from '@/components/conversation-list/utils';
import type { Conversation } from '@/types/electron-api';

const STATUS_META = {
  pending: { dot: 'bg-blue-500', label: '等待确认', pulse: true },
  running: { dot: 'bg-orange-500', label: '运行中', pulse: true },
  delivered: { dot: 'bg-emerald-500', label: '已交付', pulse: false },
  stopped: { dot: 'bg-muted-foreground/60', label: '已停止', pulse: false },
} as const;

type RowStatus = keyof typeof STATUS_META | null;

const fallbackCache = new Map<string, Promise<Conversation[]>>();

function workspaceConversations(workspaceId: string): Promise<Conversation[]> {
  let p = fallbackCache.get(workspaceId);
  if (!p) {
    p = client.getByWorkspaceId({ workspaceId })
      .then((r) => r.conversations ?? [])
      .catch(() => {
        fallbackCache.delete(workspaceId);
        return [];
      });
    fallbackCache.set(workspaceId, p);
  }
  return p;
}

/** 父会话下的 agent 派出子会话（createdAt 升序）：订阅 conversation-store 分片，分片未加载（跨工作区定时任务等）时 IPC 兜底拉一次 */
function useChildSessions(parentConversationId: string, workspaceId: string): Conversation[] {
  const slice = useConversationStore((s) => s.byWorkspace[workspaceId]);
  const [fallback, setFallback] = useState<Conversation[] | null>(null);

  const sliceLoaded = !!slice;
  useEffect(() => {
    if (sliceLoaded) return;
    let cancelled = false;
    workspaceConversations(workspaceId).then((convs) => {
      if (!cancelled) setFallback(convs);
    });
    return () => { cancelled = true; };
  }, [workspaceId, sliceLoaded]);

  return useMemo(() => {
    const conversations = slice?.conversations ?? fallback ?? [];
    const parentSessionId = conversations.find((c) => c.id === parentConversationId)?.sessionId;
    if (!parentSessionId) return [];
    return conversations
      .filter((c) => c.contractMetadata?.createdBy === 'agent' && c.contractMetadata.parentSessionId === parentSessionId)
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  }, [slice, fallback, parentConversationId]);
}

interface ListProps {
  sessions: Conversation[];
  onOpen: (conversationId: string) => void;
}

/** 子会话条目列表（状态徽标照 ConversationRow 语义，createdAt 升序；空数组不渲染） */
function ChildSessionList({ sessions, onOpen }: ListProps) {
  const childSnapshotsById = useConversationStore((s) => s.childSnapshotsById);
  const runningIds = useConversationStore((s) => s.runningConversationIds);
  const pendingIds = useConversationStore((s) => s.pendingActionConversationIds);

  if (sessions.length === 0) return null;

  return (
    <div>
      {sessions.map((child) => {
        const snapshot = childSnapshotsById[child.id];
        const isDisplayRunning = runningIds.has(child.id) || snapshot?.status === 'running';
        const status: RowStatus = isDisplayRunning
          ? (pendingIds.has(child.id) ? 'pending' : 'running')
          : snapshot?.delivered
            ? 'delivered'
            : snapshot?.status === 'stopped'
              ? 'stopped'
              : null;
        const meta = status ? STATUS_META[status] : null;
        return (
          <button
            key={child.id}
            type="button"
            onClick={() => onOpen(child.id)}
            title={getConversationTitle(child)}
            className="flex items-center gap-2 w-full pl-6 pr-3 py-1.5 text-xs text-muted-foreground text-left hover:text-foreground hover:bg-muted/60 rounded-sm transition-colors"
          >
            <span className="flex items-center justify-center w-3 shrink-0">
              {meta && (
                <span
                  title={meta.label}
                  className={cn(
                    'rounded-full',
                    status === 'running' ? 'w-2 h-2' : 'w-1.5 h-1.5',
                    meta.dot,
                    meta.pulse && 'animate-pulse',
                  )}
                />
              )}
            </span>
            <span className="truncate">{getConversationTitle(child)}</span>
          </button>
        );
      })}
    </div>
  );
}

interface FoldProps {
  parentConversationId: string;
  workspaceId: string;
  onOpen: (conversationId: string) => void;
  children: (toggle: ReactNode | null) => ReactNode;
}

/** 任务面板父行（执行会话/定时运行）的子会话折叠容器：默认收起，toggle 为计数+开关置于父行行首（无子会话为 null），父行布局由调用方经 render prop 控制 */
export function ChildSessionFold({ parentConversationId, workspaceId, onOpen, children }: FoldProps) {
  const [expanded, setExpanded] = useState(false);
  const sessions = useChildSessions(parentConversationId, workspaceId);

  if (sessions.length === 0) return children(null);

  const toggle = (
    <span
      onClick={(e) => {
        e.stopPropagation();
        setExpanded((v) => !v);
      }}
      className="inline-flex items-center gap-1 shrink-0 text-muted-foreground/60 tabular-nums hover:text-foreground transition-colors"
    >
      <span>{sessions.length}</span>
      {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
    </span>
  );

  return (
    <>
      {children(toggle)}
      {expanded && <ChildSessionList sessions={sessions} onOpen={onOpen} />}
    </>
  );
}
