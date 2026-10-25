import { useCallback, useRef, useState } from 'react';
import {
  ChevronDown, ChevronRight, CornerUpRight, GitBranch, ListTodo, MessagesSquare, MoreHorizontal, Network,
} from 'lucide-react';
import { toast } from 'sonner';
import { client } from '@/lib/client';
import {
  ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useConversationStore } from '@/stores/conversation-store';
import { useReferenceStore } from '@/stores/reference-store';
import { requireAnchorConversationId } from '@/lib/reference-guard';
import type { Conversation } from '@/components/ConversationList';
import { getConversationTitle, getRelativeTime, openOrFocusConversation, useNodeHighlight } from './utils';

export interface ConversationRowExpandToggle {
  expanded: boolean;
  onToggle: () => void;
}

export interface ConversationRowProps {
  conv: Conversation;
  nodeId: string;
  onClick?: () => void;
  indent?: number;
  readOnly?: boolean;
  childCount?: number;
  childRunning?: boolean;
  expandToggle?: ConversationRowExpandToggle;
}

const STATUS_META = {
  pending: { dot: 'bg-blue-500', text: 'text-blue-600 dark:text-blue-400', label: '等待确认', pulse: true },
  running: { dot: 'bg-orange-500', text: 'text-orange-600 dark:text-orange-400', label: '运行中', pulse: true },
  delivered: { dot: 'bg-emerald-500', text: 'text-emerald-600 dark:text-emerald-400', label: '已交付', pulse: false },
  stopped: { dot: 'bg-muted-foreground/60', text: 'text-muted-foreground', label: '已停止', pulse: false },
} as const;

type RowStatus = keyof typeof STATUS_META | null;

export function ConversationRow({
  conv,
  nodeId,
  onClick,
  indent = 8,
  readOnly = false,
  childCount,
  childRunning,
  expandToggle,
}: ConversationRowProps) {
  const deleteConversation = useConversationStore((s) => s.deleteConversation);
  const updateConversationTitle = useConversationStore((s) => s.updateConversationTitle);
  const setConversationHold = useConversationStore((s) => s.setConversationHold);
  const runningIds = useConversationStore((s) => s.runningConversationIds);
  const pendingIds = useConversationStore((s) => s.pendingActionConversationIds);
  const aliveIds = useConversationStore((s) => s.aliveConversationIds);
  const childSnapshot = useConversationStore((s) => s.childSnapshotsById[conv.id]);
  const { isOpen, isSelected } = useNodeHighlight(conv.id, nodeId);

  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const editInputRef = useRef<HTMLInputElement>(null);

  const isFork = !!conv.parentConversationId;
  const isAgentConversation = conv.contractMetadata?.createdBy === 'agent';
  const isUnread = !!conv.unread;
  const isRunning = runningIds.has(conv.id);
  const isPending = pendingIds.has(conv.id);
  const isAlive = aliveIds.has(conv.id);
  const isPinned = !!conv.pinnedAt;
  const isChildRunning = childSnapshot?.status === 'running';
  const isDisplayRunning = isRunning || isChildRunning;
  // 自动亮（非 running 恒亮）同钉住走「关闭」，与侧轨三态按钮同款动作映射
  const holdClear = isPinned || (isAlive && !isDisplayRunning);
  const hasChildren = !!expandToggle;

  const status: RowStatus = isDisplayRunning
    ? (isPending ? 'pending' : 'running')
    : childSnapshot?.delivered
      ? 'delivered'
      : childSnapshot?.status === 'stopped'
        ? 'stopped'
        : null;

  const startEditing = useCallback(() => {
    setEditTitle(getConversationTitle(conv));
    setIsEditing(true);
    setTimeout(() => {
      editInputRef.current?.focus();
      editInputRef.current?.select();
    }, 0);
  }, [conv]);

  const saveTitle = useCallback(() => {
    const trimmed = editTitle.trim();
    void updateConversationTitle(conv.id, trimmed || getConversationTitle(conv));
    setIsEditing(false);
  }, [conv, editTitle, updateConversationTitle]);

  const handleClick = useCallback(() => {
    if (onClick) onClick();
    else openOrFocusConversation(conv, nodeId);
  }, [conv, nodeId, onClick]);

  const continueToNewConversation = useCallback(async () => {
    try {
      const r = await client.continueConversation({ sourceConversationId: conv.id });
      if (!r.ok || !r.conversationId) {
        toast.error('延续失败', { description: r.error ?? undefined });
        return;
      }
      toast.success(`已延续到「${r.title ?? '新会话'}」`, { description: r.warning ?? undefined });
      void useConversationStore.getState().focusConversationFromLink(
        `dogear://conversation/${r.conversationId}?ws=${encodeURIComponent(conv.workspaceId)}`,
      );
    } catch (err) {
      toast.error('延续失败', { description: err instanceof Error ? err.message : String(err) });
    }
  }, [conv]);

  const isTaskExecution = getConversationTitle(conv).startsWith('任务: ');
  const typeIcon = isTaskExecution
    ? <ListTodo className="w-4 h-4 flex-shrink-0 text-amber-600 dark:text-amber-400" />
    : isAgentConversation
    ? <Network className={cn('w-4 h-4 flex-shrink-0', isSelected ? 'text-blue-600 dark:text-blue-400' : 'text-muted-foreground')} />
    : isFork
      ? <GitBranch className={cn('w-4 h-4 flex-shrink-0', isSelected ? 'text-purple-600 dark:text-purple-300' : 'text-purple-400')} />
      : <MessagesSquare className={cn('w-4 h-4 flex-shrink-0', isSelected ? 'text-blue-600 dark:text-blue-400' : 'text-muted-foreground')} />;

  const statusDot = status === 'running' || status === 'pending' ? (
    <span className="flex items-center justify-center w-4 h-4 flex-shrink-0">
      <span
        className={cn(
          'rounded-full',
          status === 'running' ? 'w-2.5 h-2.5' : 'w-2 h-2',
          STATUS_META[status].dot,
          STATUS_META[status].pulse && 'animate-pulse',
        )}
        title={STATUS_META[status].label}
      />
    </span>
  ) : null;
  const unreadDot = isUnread ? (
    <span className="flex items-center justify-center w-4 h-4 flex-shrink-0">
      <span
        className={cn('w-2 h-2 rounded-full', conv.unread === 'error' ? 'bg-red-500' : 'bg-emerald-500')}
        title={conv.unread === 'error' ? '执行失败' : '未读'}
      />
    </span>
  ) : null;
  const iconSlot = statusDot ?? unreadDot ?? typeIcon;

  const row = (
    <div
      data-node-id={nodeId}
      className={cn(
        'relative flex items-center gap-2 py-2 pr-3 cursor-pointer transition-colors group rounded-sm mx-1',
        isSelected ? 'bg-blue-100 dark:bg-blue-900/30'
          : isOpen ? 'bg-muted/60'
          : 'hover:bg-muted/30',
      )}
      style={{ paddingLeft: `${indent}px` }}
      onClick={handleClick}
    >
      {(isDisplayRunning || isAlive || isPinned) && (
        <span
          className={cn(
            'absolute left-0 top-1.5 bottom-1.5 w-1 rounded-full',
            isPending ? 'bg-blue-500' : isDisplayRunning ? 'bg-orange-500' : 'bg-emerald-500',
          )}
          title={isDisplayRunning ? undefined : isPinned ? '稍后继续' : '最近活跃'}
        />
      )}
      {hasChildren ? (
        <span
          className="relative flex items-center justify-center w-4 h-4 flex-shrink-0"
          title="展开/收起子会话"
          onClick={(event) => {
            event.stopPropagation();
            expandToggle?.onToggle();
          }}
        >
          {expandToggle.expanded
            ? <ChevronDown className="absolute w-3.5 h-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
            : <ChevronRight className="absolute w-3.5 h-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />}
          <span className="group-hover:opacity-0 transition-opacity">{iconSlot}</span>
        </span>
      ) : iconSlot}
      <div className="flex-1 min-w-0">
        {isEditing ? (
          <input
            ref={editInputRef}
            value={editTitle}
            onChange={(event) => setEditTitle(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') saveTitle();
              else if (event.key === 'Escape') setIsEditing(false);
              event.stopPropagation();
            }}
            onBlur={saveTitle}
            onClick={(event) => event.stopPropagation()}
            className="w-full bg-background border border-primary rounded px-1.5 py-0.5 text-sm outline-none"
          />
        ) : (
          <div
            className={cn(
              'text-sm truncate',
              isSelected ? 'text-blue-700 dark:text-blue-300 font-medium'
                : isUnread ? 'font-medium text-foreground'
                : 'text-foreground',
            )}
            title={getConversationTitle(conv)}
          >
            {getConversationTitle(conv)}
          </div>
        )}
        <div className="flex items-center gap-1 text-xs text-muted-foreground min-w-0">
          <span className="shrink-0">{getRelativeTime(conv.updatedAt)}</span>
          {status && (
            <span className="flex items-center gap-1 shrink-0">
              <span>·</span>
              <span className={cn(
                'w-1.5 h-1.5 rounded-full flex-shrink-0',
                STATUS_META[status].dot,
                STATUS_META[status].pulse && 'animate-pulse',
              )} />
              <span className={STATUS_META[status].text}>{STATUS_META[status].label}</span>
            </span>
          )}
          {hasChildren && childCount != null && childCount > 0 && (
            <span className="flex items-center gap-1 shrink-0">
              <span>· {childCount} 个子会话</span>
              {childRunning && (
                <span
                  className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-orange-500 animate-pulse"
                  title="有子会话运行中"
                />
              )}
            </span>
          )}
          {!readOnly && !isEditing && (
            <span className="ml-auto flex items-center opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto group-data-[state=open]:opacity-100 group-data-[state=open]:pointer-events-auto transition-opacity shrink-0">
              <Button
                variant="ghost"
                size="sm"
                className="h-5 w-5 p-0 text-muted-foreground hover:text-foreground"
                onClick={(event) => {
                  event.stopPropagation();
                  const rect = event.currentTarget.getBoundingClientRect();
                  event.currentTarget.dispatchEvent(new MouseEvent('contextmenu', {
                    bubbles: true,
                    clientX: rect.left,
                    clientY: rect.bottom,
                  }));
                }}
                title="对话操作"
              >
                <MoreHorizontal className="w-3 h-3" />
              </Button>
            </span>
          )}
        </div>
      </div>
      {hasChildren && !expandToggle?.expanded && (
        <span className="absolute inset-x-1.5 bottom-0 h-1 pointer-events-none rounded-b-sm shadow-[0_2px_2px_-1px_rgba(0,0,0,0.14),0_4px_5px_-2px_rgba(0,0,0,0.1)] transition-shadow group-hover:shadow-[0_2px_3px_-1px_rgba(0,0,0,0.22),0_5px_7px_-2px_rgba(0,0,0,0.14)]" />
      )}
    </div>
  );

  if (readOnly) return row;

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{row}</ContextMenuTrigger>
      <ContextMenuContent onCloseAutoFocus={(event) => event.preventDefault()}>
        <ContextMenuItem onClick={() => void setConversationHold(conv.id, holdClear ? 'clear' : 'pin')}>
          {holdClear ? '关闭' : '稍后继续'}
        </ContextMenuItem>
        <ContextMenuItem onClick={startEditing}>重命名</ContextMenuItem>
        <ContextMenuItem onClick={() => {
          const anchorId = requireAnchorConversationId();
          if (!anchorId) return;
          useReferenceStore.getState().addReferencedConversation({
            conversationId: conv.id,
            title: getConversationTitle(conv),
            sessionId: conv.sessionId || null,
            workspaceId: conv.workspaceId,
          }, anchorId);
        }}>
          引用到当前对话
        </ContextMenuItem>
        <ContextMenuItem onClick={() => void continueToNewConversation()}>
          <CornerUpRight className="w-3.5 h-3.5 mr-1.5 text-muted-foreground" />
          延续到新会话
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem className="text-destructive" onClick={() => void deleteConversation(conv.id)}>
          删除对话
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
