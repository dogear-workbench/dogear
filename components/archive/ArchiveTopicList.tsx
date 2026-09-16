import { useMemo } from 'react';
import { ArchiveRestore, ChevronDown, ChevronRight, MessagesSquare } from 'lucide-react';
import { toast } from 'sonner';
import {
  ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { cn } from '@/lib/utils';
import { useGroupStore } from '@/stores/group-store';
import { showConfirm } from '@/stores/confirm-store';
import { deriveGroupTitle } from '@/components/group-list/utils';
import { getConversationTitle, getRelativeTime } from '@/components/conversation-list/utils';
import type { ConversationTreeNode } from '@/lib/conversation-sort';
import type { ArchiveSelection, ArchivedTopicData } from './types';
import { countDescendants, countTreeConversations } from './utils';

interface ArchiveTopicListProps {
  topics: ArchivedTopicData[];
  expandedIds: Set<string>;
  onToggleExpand: (topicId: string) => void;
  selection: ArchiveSelection | null;
  onSelect: (selection: ArchiveSelection) => void;
}

function ArchiveConversationRow({
  topicId,
  node,
  selected,
  onSelect,
}: {
  topicId: string;
  node: ConversationTreeNode;
  selected: boolean;
  onSelect: (selection: ArchiveSelection) => void;
}) {
  const childTotal = countDescendants(node);
  return (
    <div
      className={cn(
        'relative flex items-center gap-2 py-2 pr-3 cursor-pointer transition-colors group rounded-sm mx-1',
        selected ? 'bg-blue-100 dark:bg-blue-900/30' : 'hover:bg-muted/30',
      )}
      style={{ paddingLeft: '8px' }}
      onClick={() => onSelect({ topicId, conversationId: node.conv.id })}
    >
      <MessagesSquare className="w-4 h-4 flex-shrink-0 text-muted-foreground" />
      <div className="flex-1 min-w-0">
        <div
          className={cn('text-sm truncate', selected ? 'text-blue-700 dark:text-blue-300 font-medium' : 'text-foreground')}
          title={getConversationTitle(node.conv)}
        >
          {getConversationTitle(node.conv)}
        </div>
        <div className="flex items-center gap-1 text-xs text-muted-foreground min-w-0">
          <span className="shrink-0">{getRelativeTime(node.conv.updated_at)}</span>
          {childTotal > 0 && (
            <span
              className="shrink-0 text-[10px] leading-none px-1 py-0.5 rounded bg-muted text-muted-foreground"
              title={`${childTotal} 个子会话`}
            >
              {childTotal} 个子会话
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function ArchiveTopicCard({
  topic,
  expanded,
  selected,
  onToggleExpand,
  onSelect,
}: {
  topic: ArchivedTopicData;
  expanded: boolean;
  selected: ArchiveSelection | null;
  onToggleExpand: (topicId: string) => void;
  onSelect: (selection: ArchiveSelection) => void;
}) {
  const { group, tree } = topic;
  const totalCount = useMemo(() => countTreeConversations(tree), [tree]);

  const handleRestore = async () => {
    const ok = await useGroupStore.getState().restoreTopic(group.id);
    if (ok) {
      toast.success('话题已恢复');
    }
  };

  const handleDelete = async () => {
    const confirmed = await showConfirm(
      '永久删除话题',
      `将永久删除话题内 ${totalCount} 个对话及共享区。此操作不可恢复。`,
    );
    if (!confirmed) return;
    await useGroupStore.getState().deleteTopic(group.id);
  };

  return (
    <div className="mb-0.5">
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            className="relative flex items-center gap-2 py-1 pr-2 pl-2 cursor-pointer hover:bg-muted/30 group rounded-sm mx-1"
            onClick={() => onToggleExpand(group.id)}
          >
            <span className="flex items-center justify-center w-4 h-4 flex-shrink-0">
              {expanded
                ? <ChevronDown className="w-3 h-3 text-muted-foreground" />
                : <ChevronRight className="w-3 h-3 text-muted-foreground" />}
            </span>
            <div className="flex-1 min-w-0">
              <span className="text-[15px] text-foreground font-semibold truncate" title={deriveGroupTitle(group)}>
                {deriveGroupTitle(group)}
              </span>
            </div>
            <span className="text-xs text-muted-foreground flex-shrink-0">{totalCount}</span>
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent onCloseAutoFocus={(event) => event.preventDefault()}>
          <ContextMenuItem onClick={() => void handleRestore()}>
            <ArchiveRestore className="w-3.5 h-3.5 mr-2" />
            恢复话题
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem className="text-destructive" onClick={() => void handleDelete()}>
            永久删除话题
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
      {expanded && tree.map((node) => (
        <ArchiveConversationRow
          key={node.conv.id}
          topicId={group.id}
          node={node}
          selected={selected?.topicId === group.id && selected.conversationId === node.conv.id}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}

export function ArchiveTopicList({
  topics,
  expandedIds,
  onToggleExpand,
  selection,
  onSelect,
}: ArchiveTopicListProps) {
  return (
    <>
      {topics.map((topic) => (
        <ArchiveTopicCard
          key={topic.group.id}
          topic={topic}
          expanded={expandedIds.has(topic.group.id)}
          selected={selection}
          onToggleExpand={onToggleExpand}
          onSelect={onSelect}
        />
      ))}
    </>
  );
}
