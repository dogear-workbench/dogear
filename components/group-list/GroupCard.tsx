import { Fragment, useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import { Archive, ArchiveRestore, ChevronDown, ChevronRight, FolderOutput, MoreHorizontal, Plus } from 'lucide-react';
import {
  ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { client } from '@/lib/client';
import { useGroupStore } from '@/stores/group-store';
import { useConversationStore } from '@/stores/conversation-store';
import { useSectionCollapseStore } from '@/stores/section-collapse-store';
import { useWorkspaceStore } from '@/stores/workspace-store';
import { showConfirm } from '@/stores/confirm-store';
import type { Group } from '@/types/group';
import type { ConversationTreeNode } from '@/lib/conversation-sort';
import { ConversationRow } from '@/components/conversation-list/ConversationRow';
import { openOrFocusConversation } from '@/components/conversation-list/utils';
import { AddGroupToFolderMenu } from '@/components/conversation-list/AddGroupToFolderMenu';
import { MoveGroupToFolderMenu } from '@/components/conversation-list/MoveGroupToFolderMenu';
import { deriveGroupTitle } from './utils';

interface GroupCardProps {
  group: Group;
  tree: ConversationTreeNode[];
  folderId?: string;
  mode?: 'active' | 'archived';
}

function countTreeConversations(nodes: ConversationTreeNode[]): number {
  return nodes.reduce((total, node) => total + 1 + countTreeConversations(node.children), 0);
}

export function GroupCard({ group, tree, folderId, mode = 'active' }: GroupCardProps) {
  const expandedGroupIds = useGroupStore((s) => s.expandedGroupIds);
  const currentGroupId = useGroupStore((s) => s.currentGroupId);
  const isExpanded = expandedGroupIds.has(group.id);
  const isSelected = currentGroupId === group.id;
  const removeGroupFromFolder = useConversationStore((s) => s.removeGroupFromFolder);
  const subExpandedConvIds = useSectionCollapseStore((s) => s.subExpandedConvIds);
  const toggleSubExpand = useSectionCollapseStore((s) => s.toggleSubExpand);
  const isArchived = mode === 'archived';
  const totalCount = useMemo(() => countTreeConversations(tree), [tree]);

  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const editInputRef = useRef<HTMLInputElement>(null);

  const startEditing = useCallback(() => {
    setEditTitle(group.title ?? '');
    setIsEditing(true);
    setTimeout(() => {
      editInputRef.current?.focus();
      editInputRef.current?.select();
    }, 0);
  }, [group.title]);

  const saveTitle = useCallback(() => {
    const trimmed = editTitle.trim();
    if (trimmed) {
      void useGroupStore.getState().updateGroup(group.id, { title: trimmed });
    }
    setIsEditing(false);
  }, [editTitle, group.id]);

  const handleHeaderClick = useCallback(() => {
    useGroupStore.getState().toggleExpand(group.id);
    useGroupStore.getState().setCurrentGroup(group.id);
  }, [group.id]);

  const handleNewConversation = useCallback(async () => {
    const workspace = useWorkspaceStore.getState().workspace;
    if (!workspace) return;
    const result = await client.create({ workspaceId: workspace.id, groupId: group.id });
    if (result.conversationId) {
      const detail = await client.getById({ conversationId: result.conversationId, workspaceId: workspace.id });
      if (detail.conversation) {
        await useConversationStore.getState().selectConversation(detail.conversation);
        openOrFocusConversation(detail.conversation, `topic:${group.id}:${detail.conversation.id}`);
      }
      if (!useGroupStore.getState().expandedGroupIds.has(group.id)) {
        useGroupStore.getState().toggleExpand(group.id);
      }
    }
  }, [group.id]);

  const handleArchive = useCallback(async () => {
    const confirmed = await showConfirm(
      '归档话题',
      `归档后将保留话题内 ${totalCount} 个对话及共享区，仅可查看历史；恢复话题后才能继续工作。`,
    );
    if (!confirmed) return;
    await useGroupStore.getState().archiveTopic(group.id);
  }, [totalCount, group.id]);

  const handleRestore = useCallback(async () => {
    await useGroupStore.getState().restoreTopic(group.id);
  }, [group.id]);

  const handleDelete = useCallback(async () => {
    const confirmed = await showConfirm(
      '永久删除话题',
      `将永久删除话题内 ${totalCount} 个对话及共享区。此操作不可恢复。`,
    );
    if (!confirmed) return;
    await useGroupStore.getState().deleteTopic(group.id);
  }, [totalCount, group.id]);

  const renderNodes = (nodes: ConversationTreeNode[], indent: number): ReactNode[] =>
    nodes.map((node) => {
      const hasChildren = node.children.length > 0;
      const subExpanded = hasChildren && subExpandedConvIds.has(node.conv.id);
      return (
        <Fragment key={node.conv.id}>
          <ConversationRow
            conv={node.conv}
            nodeId={`topic:${group.id}:${node.conv.id}`}
            indent={indent}
            readOnly={isArchived}
            childCount={hasChildren ? node.children.length : undefined}
            expandToggle={hasChildren ? {
              expanded: subExpanded,
              onToggle: () => toggleSubExpand(node.conv.id),
            } : undefined}
          />
          {subExpanded && renderNodes(node.children, indent + 16)}
        </Fragment>
      );
    });

  return (
    <div className="mb-0.5">
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            className={cn(
              'relative flex items-center gap-2 py-1 pr-2 pl-2 cursor-pointer hover:bg-muted/30 group rounded-sm mx-1',
              isSelected && 'bg-muted/40',
            )}
            onClick={handleHeaderClick}
          >
            <span className="flex items-center justify-center w-4 h-4 flex-shrink-0">
              {isExpanded
                ? <ChevronDown className="w-3 h-3 text-muted-foreground" />
                : <ChevronRight className="w-3 h-3 text-muted-foreground" />
              }
            </span>
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
                  className="w-full bg-background border border-primary rounded px-1.5 py-0.5 text-xs outline-none"
                />
              ) : (
                <div className="flex items-center gap-1">
                  <span className="text-xs text-muted-foreground truncate" title={deriveGroupTitle(group)}>{deriveGroupTitle(group)}</span>
                </div>
              )}
            </div>
            <span className="text-xs text-muted-foreground flex-shrink-0">{totalCount}</span>
            {!isEditing && (
              <div
                className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-0.5 pl-2.5 pr-0.5 rounded-sm bg-gradient-to-l from-background via-background to-transparent opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto group-data-[state=open]:opacity-100 group-data-[state=open]:pointer-events-auto transition-opacity"
              >
                {!isArchived && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground"
                    onClick={(event) => {
                      event.stopPropagation();
                      void handleNewConversation();
                    }}
                    title="在话题内新建对话"
                  >
                    <Plus className="w-3 h-3" />
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground"
                  onClick={(event) => {
                    event.stopPropagation();
                    const rect = event.currentTarget.getBoundingClientRect();
                    event.currentTarget.dispatchEvent(new MouseEvent('contextmenu', {
                      bubbles: true,
                      clientX: rect.left,
                      clientY: rect.bottom,
                    }));
                  }}
                  title="话题操作"
                >
                  <MoreHorizontal className="w-3 h-3" />
                </Button>
              </div>
            )}
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent onCloseAutoFocus={(event) => event.preventDefault()}>
          {isArchived ? (
            <>
              <ContextMenuItem onClick={() => void handleRestore()}>
                <ArchiveRestore className="w-3.5 h-3.5 mr-2" />
                恢复话题
              </ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem className="text-destructive" onClick={() => void handleDelete()}>
                永久删除话题
              </ContextMenuItem>
            </>
          ) : (
            <>
              <ContextMenuItem onClick={startEditing}>重命名话题</ContextMenuItem>
              <ContextMenuItem onClick={() => void handleNewConversation()}>在话题内新建对话</ContextMenuItem>
              <ContextMenuSeparator />
              {folderId ? (
                <>
                  <MoveGroupToFolderMenu groupId={group.id} fromFolderId={folderId} />
                  <ContextMenuItem onClick={() => void removeGroupFromFolder(group.id, folderId)}>
                    <FolderOutput className="w-3.5 h-3.5 mr-2" />
                    从文件夹移除话题
                  </ContextMenuItem>
                </>
              ) : (
                <AddGroupToFolderMenu groupId={group.id} />
              )}
              <ContextMenuSeparator />
              <ContextMenuItem onClick={() => void handleArchive()}>
                <Archive className="w-3.5 h-3.5 mr-2" />
                归档话题
              </ContextMenuItem>
              <ContextMenuItem className="text-destructive" onClick={() => void handleDelete()}>
                永久删除话题
              </ContextMenuItem>
            </>
          )}
        </ContextMenuContent>
      </ContextMenu>

      {isExpanded && renderNodes(tree, 8)}
    </div>
  );
}
