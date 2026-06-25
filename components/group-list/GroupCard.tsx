import React, { useCallback, useRef, useState } from 'react';
import { ChevronRight, ChevronDown, MoreHorizontal, Plus } from 'lucide-react';
import {
  ContextMenu, ContextMenuTrigger, ContextMenuContent,
  ContextMenuItem, ContextMenuSeparator,
} from '@/components/ui/context-menu';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { client } from '@/lib/client';
import { useGroupStore } from '@/stores/group-store';
import { useConversationStore } from '@/stores/conversation-store';
import { useWorkspaceStore } from '@/stores/workspace-store';
import type { Group } from '@/types/group';
import type { Conversation } from '@/components/ConversationList';
import { ConversationRow } from '@/components/conversation-list/ConversationRow';
import { openOrFocusConversation } from '@/components/conversation-list/utils';
import { deriveGroupTitle } from './utils';

interface GroupCardProps {
  group: Group;
  conversations: Conversation[];
}

export function GroupCard({ group, conversations }: GroupCardProps) {
  const expandedGroupIds = useGroupStore((s) => s.expandedGroupIds);
  const currentGroupId = useGroupStore((s) => s.currentGroupId);
  const isExpanded = expandedGroupIds.has(group.id);
  const isSelected = currentGroupId === group.id;

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
      useGroupStore.getState().updateGroup(group.id, { title: trimmed });
    }
    setIsEditing(false);
  }, [editTitle, group.id]);

  const cancelEditing = useCallback(() => {
    setIsEditing(false);
  }, []);

  const handleHeaderClick = useCallback(() => {
    useGroupStore.getState().toggleExpand(group.id);
    useGroupStore.getState().setCurrentGroup(group.id);
  }, [group.id]);

  const handleNewConversation = useCallback(async () => {
    const workspace = useWorkspaceStore.getState().workspace;
    if (!workspace) return;
    const r = await client.create({ workspaceId: workspace.id, groupId: group.id });
    if (r.conversationId) {
      const detail = await client.getById({ conversationId: r.conversationId, workspaceId: workspace.id });
      if (detail.conversation) {
        await useConversationStore.getState().selectConversation(detail.conversation);
        openOrFocusConversation(detail.conversation, `group:${group.id}:${detail.conversation.id}`);
      }
      await useConversationStore.getState().loadConversations();
      const expanded = useGroupStore.getState().expandedGroupIds;
      if (!expanded.has(group.id)) useGroupStore.getState().toggleExpand(group.id);
    }
  }, [group.id]);

  const handleDelete = useCallback(() => {
    useGroupStore.getState().deleteGroup(group.id);
  }, [group.id]);

  return (
    <div className="mb-0.5">
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            className={cn(
              'flex items-center gap-2 py-1 pr-2 pl-2 cursor-pointer hover:bg-muted/30 group rounded-sm mx-1',
              isSelected && 'bg-muted/40',
            )}
            onClick={handleHeaderClick}
          >
            {isExpanded
              ? <ChevronDown className="w-3 h-3 flex-shrink-0 text-muted-foreground" />
              : <ChevronRight className="w-3 h-3 flex-shrink-0 text-muted-foreground" />
            }
            <div className="flex-1 min-w-0">
              {isEditing ? (
                <input
                  ref={editInputRef}
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') saveTitle();
                    else if (e.key === 'Escape') cancelEditing();
                    e.stopPropagation();
                  }}
                  onBlur={saveTitle}
                  onClick={(e) => e.stopPropagation()}
                  className="w-full bg-background border border-primary rounded px-1.5 py-0.5 text-xs outline-none"
                />
              ) : (
                <span className="text-xs text-muted-foreground truncate block">{deriveGroupTitle(group, conversations)}</span>
              )}
            </div>
            <span className="text-xs text-muted-foreground flex-shrink-0">{conversations.length}</span>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground"
              onClick={(e) => {
                e.stopPropagation();
                handleNewConversation();
              }}
              title="在组内新建对话"
            >
              <Plus className="w-3 h-3" />
            </Button>
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
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent onCloseAutoFocus={(e) => e.preventDefault()}>
          <ContextMenuItem onClick={startEditing}>重命名</ContextMenuItem>
          <ContextMenuItem onClick={handleNewConversation}>在组内新建对话</ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem className="text-destructive" onClick={handleDelete}>
            删除组
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      {isExpanded && conversations.map((conv) => (
        <ConversationRow
          key={conv.id}
          conv={conv}
          nodeId={`group:${group.id}:${conv.id}`}
          indent={24}
        />
      ))}
    </div>
  );
}
