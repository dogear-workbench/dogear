import React, { useCallback } from 'react';
import { Loader2, CircleCheck, CircleX, Clock, Ban, AlertTriangle, CornerDownRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useConversationStore } from '@/stores/conversation-store';
import type { ChildStateSnapshot, ChildStatus } from '@/types/delegation';
import { openOrFocusConversation, useNodeHighlight } from './utils';

interface ChildConversationRowProps {
  snapshot: ChildStateSnapshot;
  /** 父行的 indent，本行额外再加 16px 表示嵌套 */
  parentIndent: number;
  /** 父行 nodeId，本行 nodeId 拼上 sub:{childId} */
  parentNodeId: string;
}

function statusIcon(status: ChildStatus, className: string) {
  switch (status) {
    case 'running':     return <Loader2 className={cn(className, 'animate-spin text-blue-500')} />;
    case 'done':        return <CircleCheck className={cn(className, 'text-green-500')} />;
    case 'failed':      return <CircleX className={cn(className, 'text-destructive')} />;
    case 'timeout':     return <Clock className={cn(className, 'text-muted-foreground')} />;
    case 'cancelled':   return <Ban className={cn(className, 'text-muted-foreground')} />;
    case 'no_delivery': return <AlertTriangle className={cn(className, 'text-amber-500')} />;
  }
}

function statusLabel(status: ChildStatus): string {
  switch (status) {
    case 'running':     return '运行中';
    case 'done':        return '已交付';
    case 'failed':      return '失败';
    case 'timeout':     return '超时';
    case 'cancelled':   return '已停止';
    case 'no_delivery': return '未交付';
  }
}

export function ChildConversationRow({ snapshot, parentIndent, parentNodeId }: ChildConversationRowProps) {
  const conversations = useConversationStore((s) => s.conversations);
  const nodeId = `${parentNodeId}::sub::${snapshot.childId}`;
  const { isOpen, isSelected } = useNodeHighlight(snapshot.childId, nodeId);

  const handleClick = useCallback(() => {
    const conv = conversations.find((c) => c.id === snapshot.childId);
    if (conv) {
      openOrFocusConversation(conv, nodeId);
    }
  }, [conversations, snapshot.childId, nodeId]);

  return (
    <div
      className={cn(
        'flex items-center gap-1.5 py-1 pr-3 cursor-pointer transition-colors rounded-sm mx-1',
        isSelected ? 'bg-blue-100 dark:bg-blue-900/30'
          : isOpen ? 'bg-muted/60'
          : 'hover:bg-muted/30',
      )}
      style={{ paddingLeft: `${parentIndent + 16}px` }}
      onClick={handleClick}
      title={`${snapshot.title} → ${snapshot.outputPath}（${statusLabel(snapshot.status)}）`}
    >
      <CornerDownRight className="w-3 h-3 flex-shrink-0 text-muted-foreground" />
      {statusIcon(snapshot.status, 'w-3.5 h-3.5 flex-shrink-0')}
      <span className={cn('text-xs truncate flex-1',
        isSelected ? 'text-blue-700 dark:text-blue-300 font-medium' : 'text-muted-foreground',
      )}>
        {snapshot.title}
      </span>
      <span className="text-[10px] text-muted-foreground opacity-70 flex-shrink-0">
        {snapshot.outputPath}
      </span>
    </div>
  );
}
