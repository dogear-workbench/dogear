import React from 'react';
import { Layers } from 'lucide-react';
import { useGroupStore } from '@/stores/group-store';
import { useConversationStore } from '@/stores/conversation-store';
import { GroupCard } from './GroupCard';

interface GroupListProps {
  workspaceId: string;
}

export function GroupList({ workspaceId: _workspaceId }: GroupListProps) {
  const groups = useGroupStore((s) => s.groups);
  const conversations = useConversationStore((s) => s.conversations);

  const sorted = [...groups].sort((a, b) => b.updatedAt - a.updatedAt);

  if (sorted.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
        <Layers className="w-8 h-8 mb-2 opacity-40" />
        <p className="text-sm">暂无会话组</p>
      </div>
    );
  }

  return (
    <div className="py-1">
      {sorted.map((group) => (
        <GroupCard
          key={group.id}
          group={group}
          conversations={conversations.filter((c) => c.groupId === group.id && c.role !== 'sub')}
        />
      ))}
    </div>
  );
}
