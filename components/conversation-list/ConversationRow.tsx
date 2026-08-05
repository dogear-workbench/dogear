import React, { useCallback, useRef, useState } from 'react';
import {
  MessagesSquare, GitBranch, Bot, Workflow, MoreHorizontal, ArchiveRestore, CircleAlert, CircleCheck, Ban,
} from 'lucide-react';
import {
  ContextMenu, ContextMenuTrigger, ContextMenuContent,
  ContextMenuItem, ContextMenuSeparator,
} from '@/components/ui/context-menu';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { StatusPulse } from '@/components/StatusPulse';
import { useConversationStore } from '@/stores/conversation-store';
import { useReferenceStore } from '@/stores/reference-store';
import { client } from '@/lib/client';
import type { Conversation } from '@/components/ConversationList';
import type { ChildStateSnapshot } from '@/types/delegation';
import { getConversationTitle, getRelativeTime, openOrFocusConversation, useNodeHighlight } from './utils';

function getChildStatusPresentation(snapshot?: ChildStateSnapshot): { label: string; className: string; title: string } | null {
  if (!snapshot) return null;
  const reason = snapshot.errorMessage;
  switch (snapshot.status) {
    case 'running':
      return { label: '子会话运行中', className: 'text-orange-600 bg-orange-50 dark:bg-orange-950/30', title: '子会话正在运行' };
    case 'done':
      return { label: '已交付', className: 'text-emerald-600 bg-emerald-50 dark:bg-emerald-950/30', title: snapshot.summary || '子会话已正式交付' };
    case 'failed':
      return { label: '运行失败', className: 'text-red-600 bg-red-50 dark:bg-red-950/30', title: reason || '子会话运行失败' };
    case 'timeout':
      return { label: '已超时', className: 'text-red-600 bg-red-50 dark:bg-red-950/30', title: reason || '子会话超时中断' };
    case 'cancelled':
      return { label: '已取消', className: 'text-muted-foreground bg-muted', title: reason || '子会话已取消' };
    case 'no_delivery':
      return { label: '未交付', className: 'text-amber-700 bg-amber-50 dark:bg-amber-950/30', title: reason || '子会话结束但未正式交付' };
  }
  return null;
}

export interface ConversationRowProps {
  conv: Conversation;
  /** 节点稳定 id，用于双层高亮区分"同会话多处显示" */
  nodeId: string;
  /** 自定义点击行为（可选，默认用 openOrFocusConversation） */
  onClick?: () => void;
  /** 列表样式 indent（px），默认 8 */
  indent?: number;
  /** 归档模式：右键显示恢复/永久删除，而不是普通操作 */
  archived?: boolean;
}


export function ConversationRow({
  conv,
  nodeId,
  onClick,
  indent = 8,
  archived = false,
}: ConversationRowProps) {
  const deleteConversation = useConversationStore((s) => s.deleteConversation);
  const updateConversationTitle = useConversationStore((s) => s.updateConversationTitle);

  const runningIds = useConversationStore((s) => s.runningConversationIds);
  const pendingIds = useConversationStore((s) => s.pendingActionConversationIds);
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
  const isBotBound = conv.id === botBoundId;
  const childStatus = getChildStatusPresentation(childSnapshot);
  const isChildRunning = childSnapshot?.status === 'running';
  const isDisplayRunning = isRunning || isChildRunning;

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
    const finalTitle = trimmed || getConversationTitle(conv);
    updateConversationTitle(conv.id, finalTitle);
    setIsEditing(false);
  }, [editTitle, conv, updateConversationTitle]);

  const cancelEditing = useCallback(() => {
    setIsEditing(false);
  }, []);

  const handleClick = useCallback(() => {
    if (onClick) {
      onClick();
    } else {
      openOrFocusConversation(conv, nodeId);
    }
  }, [conv, onClick, nodeId]);

  const handleRestore = useCallback(async () => {
    await client.unarchiveConversation({ conversationId: conv.id, workspaceId: conv.workspace_id });
    useConversationStore.getState().loadConversations();
  }, [conv]);

  // 归档行的"永久删除"必须走 IPC 硬删，绕过 store.deleteConversation 内部"已归档→再归档"的分支
  const handlePermanentDelete = useCallback(async () => {
    await client.deleteConversation({ conversationId: conv.id, workspaceId: conv.workspace_id });
    useConversationStore.getState().loadConversations();
  }, [conv]);

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          className={cn(
            'flex items-center gap-2 py-2 pr-3 cursor-pointer transition-colors group rounded-sm mx-1',
            isSelected ? 'bg-blue-100 dark:bg-blue-900/30'
              : isOpen ? 'bg-muted/60'
              : 'hover:bg-muted/30',
          )}
          style={{ paddingLeft: `${indent}px` }}
          onClick={handleClick}
        >
          {isDisplayRunning ? (
            <StatusPulse isPending={isPending} />
          ) : childSnapshot?.status === 'done' ? (
            <CircleCheck className="w-4 h-4 flex-shrink-0 text-emerald-600" />
          ) : childSnapshot?.status === 'cancelled' ? (
            <Ban className="w-4 h-4 flex-shrink-0 text-muted-foreground" />
          ) : childSnapshot ? (
            <CircleAlert className="w-4 h-4 flex-shrink-0 text-red-500" />
          ) : isFork ? (
            <GitBranch className={cn('w-4 h-4 flex-shrink-0',
              isSelected ? 'text-purple-600' : 'text-purple-400'
            )} />
          ) : isAgentConversation ? (
            <Workflow className={cn('w-4 h-4 flex-shrink-0',
              isSelected ? 'text-blue-600' : 'text-muted-foreground'
            )} />
          ) : (
            <MessagesSquare className={cn('w-4 h-4 flex-shrink-0',
              isSelected ? 'text-blue-600' : 'text-muted-foreground'
            )} />
          )}
          <div className="flex-1 min-w-0">
            {isEditing ? (
              <input
                ref={editInputRef}
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    saveTitle();
                  } else if (e.key === 'Escape') {
                    cancelEditing();
                  }
                  e.stopPropagation();
                }}
                onBlur={saveTitle}
                onClick={(e) => e.stopPropagation()}
                className="w-full bg-background border border-primary rounded px-1.5 py-0.5 text-sm outline-none"
              />
            ) : (
              <div className="flex items-center gap-1">
                <div className={cn('text-sm truncate',
                  isSelected ? 'text-blue-700 dark:text-blue-300 font-medium' : 'text-foreground'
                )}>
                  {getConversationTitle(conv)}
                </div>
                {isBotBound && (
                  <Bot className="w-3 h-3 flex-shrink-0 text-green-500" />
                )}
              </div>
            )}
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span>{getRelativeTime(conv.updated_at)}</span>
              {isDisplayRunning && isPending && (
                <span className="text-[10px] text-blue-600 bg-blue-50 px-1 rounded">等待确认</span>
              )}
              {childStatus && (
                <span className={cn('text-[10px] px-1 rounded truncate max-w-28', childStatus.className)} title={childStatus.title}>
                  {childStatus.label}
                </span>
              )}
            </div>
          </div>
          {!archived && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100 data-[state=open]:opacity-100 transition-opacity text-muted-foreground hover:text-foreground"
              onClick={(e) => {
                e.stopPropagation();
                const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                e.currentTarget.dispatchEvent(new MouseEvent('contextmenu', {
                  bubbles: true,
                  clientX: rect.left,
                  clientY: rect.bottom,
                }));
              }}
            >
              <MoreHorizontal className="w-3 h-3" />
            </Button>
          )}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent onCloseAutoFocus={(e) => e.preventDefault()}>
        {archived ? (
          <>
            <ContextMenuItem onClick={handleRestore}>
              <ArchiveRestore className="w-3.5 h-3.5 mr-2" />
              恢复对话
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem
              className="text-destructive"
              onClick={handlePermanentDelete}
            >
              永久删除
            </ContextMenuItem>
          </>
        ) : (
          <>
            <ContextMenuItem onClick={startEditing}>
              重命名
            </ContextMenuItem>
            <ContextMenuItem onClick={() => {
              useReferenceStore.getState().addReferencedConversation({
                conversationId: conv.id,
                title: getConversationTitle(conv),
                sdkSessionId: conv.sdk_session_id || null,
              });
            }}>
              引用到当前对话
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem
              className="text-destructive"
              onClick={() => deleteConversation(conv.id)}
            >
              删除对话
            </ContextMenuItem>
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}
