import React from 'react';
import { Plus, FolderPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { client } from '@/lib/client';
import { useConversationStore } from '@/stores/conversation-store';
import { useGroupStore } from '@/stores/group-store';
import { useWorkspaceStore } from '@/stores/workspace-store';
import { openOrFocusConversation } from './utils';

export function Toolbar() {
  const newConversation = useConversationStore((s) => s.newConversation);
  const currentGroupId = useGroupStore((s) => s.currentGroupId);

  const handleNew = async () => {
    if (!currentGroupId) {
      await newConversation();
      return;
    }
    const workspace = useWorkspaceStore.getState().workspace;
    if (!workspace) return;
    const r = await client.create({ workspaceId: workspace.id, groupId: currentGroupId });
    if (r.conversationId) {
      const detail = await client.getById({ conversationId: r.conversationId, workspaceId: workspace.id });
      if (detail.conversation) {
        await useConversationStore.getState().selectConversation(detail.conversation);
        openOrFocusConversation(detail.conversation, `group:${currentGroupId}:${detail.conversation.id}`);
      }
      await useConversationStore.getState().loadConversations();
      const expanded = useGroupStore.getState().expandedGroupIds;
      if (!expanded.has(currentGroupId)) useGroupStore.getState().toggleExpand(currentGroupId);
    }
  };

  const handleNewGroup = async () => {
    const g = await useGroupStore.getState().createGroup();
    if (g) useGroupStore.getState().setCurrentGroup(g.id);
  };

  return (
    <div className="px-3 py-2 border-b flex items-center gap-2">
      <Button
        variant="outline"
        size="sm"
        className="flex-1 justify-start gap-2"
        onClick={handleNew}
      >
        <Plus className="w-4 h-4" />
        {currentGroupId ? '在当前组新建' : '新建对话'}
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className="h-8 w-8 p-0"
        title="新建会话组"
        onClick={handleNewGroup}
      >
        <FolderPlus className="w-4 h-4" />
      </Button>
    </div>
  );
}
