import { Fragment, useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import { Archive, ArchiveRestore, ChevronDown, ChevronRight, MoreHorizontal, Plus } from 'lucide-react';
import {
  ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useGroupStore } from '@/stores/group-store';
import { useConversationStore } from '@/stores/conversation-store';
import { useDraftStore } from '@/stores/draft-store';
import { useSectionCollapseStore } from '@/stores/section-collapse-store';
import { useSessionStore, DRAFT_VIEW_ID } from '@/stores/session-store';
import { useWorkspaceStore } from '@/stores/workspace-store';
import { showConfirm } from '@/stores/confirm-store';
import type { Group } from '@/types/group';
import type { ConversationTreeNode } from '@/lib/conversation-sort';
import { ConversationRow } from '@/components/conversation-list/ConversationRow';
import { DraftRow } from '@/components/conversation-list/DraftRow';
import { deriveGroupTitle } from './utils';

interface GroupCardProps {
  group: Group;
  tree: ConversationTreeNode[];
  mode?: 'active' | 'archived';
  /** 过滤场景：无视折叠状态全部展开，让命中会话可见 */
  forceExpanded?: boolean;
}

function countTreeConversations(nodes: ConversationTreeNode[]): number {
  return nodes.reduce((total, node) => total + 1 + countTreeConversations(node.children), 0);
}

function hasLitSessionInTree(nodes: ConversationTreeNode[], aliveIds: Set<string>): boolean {
  return nodes.some(
    (node) => aliveIds.has(node.conv.id) || !!node.conv.pinnedAt || hasLitSessionInTree(node.children, aliveIds),
  );
}

function collectTreeConvIds(nodes: ConversationTreeNode[], acc: string[]): string[] {
  for (const node of nodes) {
    acc.push(node.conv.id);
    collectTreeConvIds(node.children, acc);
  }
  return acc;
}

export function GroupCard({ group, tree, mode = 'active', forceExpanded = false }: GroupCardProps) {
  const expandedGroupIds = useGroupStore((s) => s.expandedGroupIds);
  const currentGroupId = useGroupStore((s) => s.currentGroupId);
  const isExpanded = forceExpanded || expandedGroupIds.has(group.id);
  const isSelected = currentGroupId === group.id;
  const runningIds = useConversationStore((s) => s.runningConversationIds);
  const pendingIds = useConversationStore((s) => s.pendingActionConversationIds);
  const aliveIds = useConversationStore((s) => s.aliveConversationIds);
  const subExpandedConvIds = useSectionCollapseStore((s) => s.subExpandedConvIds);
  const toggleSubExpand = useSectionCollapseStore((s) => s.toggleSubExpand);
  const isArchived = mode === 'archived';
  const workspaceId = useWorkspaceStore((s) => s.workspace?.id) ?? '';
  const draftSlot = useDraftStore((s) => s.slots[workspaceId]);
  // activeTabId === DRAFT_VIEW_ID 即草稿视图激活（槽可能不存在，行由顶部承接）；槽无 groupId 时组内不显示
  const isDraftView = useSessionStore((s) => s.activeTabId) === DRAFT_VIEW_ID;
  const showGroupDraft = !isArchived && (isDraftView || !!draftSlot?.draftActive)
    && (draftSlot?.groupId ?? null) === group.id;
  const totalCount = useMemo(() => countTreeConversations(tree), [tree]);
  const hasLitSession = useMemo(() => hasLitSessionInTree(tree, aliveIds), [tree, aliveIds]);
  const treeConvIds = useMemo(() => collectTreeConvIds(tree, []), [tree]);
  const activeCount = useMemo(
    () => treeConvIds.filter((id) => runningIds.has(id) || pendingIds.has(id)).length,
    [treeConvIds, runningIds, pendingIds],
  );
  const hasPending = useMemo(
    () => treeConvIds.some((id) => pendingIds.has(id)),
    [treeConvIds, pendingIds],
  );

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

  const handleNewConversation = useCallback(() => {
    const workspace = useWorkspaceStore.getState().workspace;
    if (!workspace) return;
    useDraftStore.getState().enterDraft(workspace.id, group.id, deriveGroupTitle(group));
    useSessionStore.getState().switchTab(DRAFT_VIEW_ID);
    if (!useGroupStore.getState().expandedGroupIds.has(group.id)) {
      useGroupStore.getState().toggleExpand(group.id);
    }
  }, [group]);

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
      const subExpanded = hasChildren && (forceExpanded || subExpandedConvIds.has(node.conv.id));
      const childRunning = hasChildren && node.children.some((child) => runningIds.has(child.conv.id));
      return (
        <Fragment key={node.conv.id}>
          <ConversationRow
            conv={node.conv}
            nodeId={`topic:${group.id}:${node.conv.id}`}
            indent={indent}
            readOnly={isArchived}
            childCount={hasChildren ? node.children.length : undefined}
            childRunning={childRunning || undefined}
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
            {hasLitSession && (
              <span
                className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-full bg-emerald-500"
                title="话题内有开着的会话"
              />
            )}
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
                  className="w-full bg-background border border-primary rounded px-1.5 py-0.5 text-[15px] outline-none"
                />
              ) : (
                <div className="flex items-center gap-1">
                  <span className="text-[15px] text-foreground font-semibold truncate" title={deriveGroupTitle(group)}>{deriveGroupTitle(group)}</span>
                </div>
              )}
            </div>
            {!isArchived && !isExpanded && activeCount > 0 && (
              <span
                className={cn(
                  'flex items-center gap-1 text-xs flex-shrink-0',
                  hasPending ? 'text-blue-600 dark:text-blue-400' : 'text-orange-600 dark:text-orange-400',
                )}
                title={hasPending ? '话题内有待确认的会话' : '话题内有运行中的会话'}
              >
                <span
                  className={cn(
                    'w-1.5 h-1.5 rounded-full animate-pulse',
                    hasPending ? 'bg-blue-500' : 'bg-orange-500',
                  )}
                />
                {activeCount}
              </span>
            )}
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
                      handleNewConversation();
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
              <ContextMenuItem onClick={handleNewConversation}>在话题内新建对话</ContextMenuItem>
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

      {isExpanded && (
        <>
          {showGroupDraft && <DraftRow groupTitle={deriveGroupTitle(group)} />}
          {renderNodes(tree, 8)}
        </>
      )}
    </div>
  );
}
