import { useCallback, useRef, useState } from 'react';
import {
  Bot, ChevronDown, ChevronRight, GitBranch, ListTodo, MessagesSquare, MoreHorizontal, Network,
} from 'lucide-react';
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
  const runningIds = useConversationStore((s) => s.runningConversationIds);
  const pendingIds = useConversationStore((s) => s.pendingActionConversationIds);
  const aliveIds = useConversationStore((s) => s.aliveConversationIds);
  const botBoundId = useConversationStore((s) => s.botBoundConversationId);
  const childSnapshot = useConversationStore((s) => s.childSnapshotsById[conv.id]);
  const { isOpen, isSelected } = useNodeHighlight(conv.id, nodeId);

  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const editInputRef = useRef<HTMLInputElement>(null);

  const isFork = !!conv.parent_conversation_id;
  const isAgentConversation = conv.contractMetadata?.createdBy === 'agent';
  const isRunning = runningIds.has(conv.id);
  const isPending = pendingIds.has(conv.id);
  const isAlive = aliveIds.has(conv.id);
  const isBotBound = conv.id === botBoundId;
  const isChildRunning = childSnapshot?.status === 'running';
  const isDisplayRunning = isRunning || isChildRunning;
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

  const isTaskExecution = getConversationTitle(conv).startsWith('任务: ');
  const typeIcon = isTaskExecution
    ? <ListTodo className="w-4 h-4 flex-shrink-0 text-amber-600 dark:text-amber-400" />
    : isAgentConversation
    ? <Network className={cn('w-4 h-4 flex-shrink-0', isSelected ? 'text-blue-600 dark:text-blue-400' : 'text-muted-foreground')} />
    : isFork
      ? <GitBranch className={cn('w-4 h-4 flex-shrink-0', isSelected ? 'text-purple-600 dark:text-purple-300' : 'text-purple-400')} />
      : <MessagesSquare className={cn('w-4 h-4 flex-shrink-0', isSelected ? 'text-blue-600 dark:text-blue-400' : 'text-muted-foreground')} />;

  const row = (
    <div
      className={cn(
        'relative flex items-center gap-2 py-2 pr-3 cursor-pointer transition-colors group rounded-sm mx-1',
        isSelected ? 'bg-blue-100 dark:bg-blue-900/30'
          : isOpen ? 'bg-muted/60'
          : 'hover:bg-muted/30',
      )}
      style={{ paddingLeft: `${indent}px` }}
      onClick={handleClick}
    >
      {(isDisplayRunning || isAlive) && (
        <span
          className={cn(
            'absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-full',
            isPending ? 'bg-blue-500' : isDisplayRunning ? 'bg-orange-500' : 'bg-emerald-500',
          )}
          title={isDisplayRunning ? undefined : '会话存活中'}
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
          <span className="group-hover:opacity-0 transition-opacity">{typeIcon}</span>
        </span>
      ) : typeIcon}
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
          <div className="flex items-center gap-1">
            <div
              className={cn('text-sm truncate', isSelected ? 'text-blue-700 dark:text-blue-300 font-medium' : 'text-foreground')}
              title={getConversationTitle(conv)}
            >
              {getConversationTitle(conv)}
            </div>
            {isBotBound && <Bot className="w-3 h-3 flex-shrink-0 text-green-500" />}
          </div>
        )}
        <div className="flex items-center gap-1 text-xs text-muted-foreground min-w-0">
          <span className="shrink-0">{getRelativeTime(conv.updated_at)}</span>
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
        <ContextMenuItem onClick={startEditing}>重命名</ContextMenuItem>
        <ContextMenuItem onClick={() => {
          const anchorId = requireAnchorConversationId();
          if (!anchorId) return;
          useReferenceStore.getState().addReferencedConversation({
            conversationId: conv.id,
            title: getConversationTitle(conv),
            sessionId: conv.session_id || null,
            workspaceId: conv.workspace_id,
          }, anchorId);
        }}>
          引用到当前对话
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem className="text-destructive" onClick={() => void deleteConversation(conv.id)}>
          删除对话
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
