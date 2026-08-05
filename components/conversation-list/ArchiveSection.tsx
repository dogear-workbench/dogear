import { useEffect, useState } from 'react';
import { Archive, ChevronDown, ChevronRight } from 'lucide-react';
import { client } from '@/lib/client';
import { GroupCard } from '@/components/group-list/GroupCard';
import { useGroupStore } from '@/stores/group-store';
import { sortConversationsWithDFS } from '@/lib/conversation-sort';
import type { Group } from '@/types/group';
import type { Conversation } from '@/components/ConversationList';

interface ArchivedTopic {
  group: Group;
  conversations: Conversation[];
}

interface ArchiveSectionProps {
  workspaceId: string;
}

export function ArchiveSection({ workspaceId }: ArchiveSectionProps) {
  const [collapsed, setCollapsed] = useState(true);
  const [topics, setTopics] = useState<ArchivedTopic[]>([]);
  const groups = useGroupStore((s) => s.groups);

  useEffect(() => {
    if (!workspaceId) {
      setTopics([]);
      return;
    }

    let cancelled = false;
    client.listArchivedTopics({ workspaceId }).then((result) => {
      if (cancelled || result.error) return;
      setTopics(
        (result.topics ?? [])
          .map((topic) => ({
            group: topic.group,
            conversations: sortConversationsWithDFS(topic.conversations as Conversation[]),
          }))
          .sort((a, b) => (b.group.archivedAt ?? 0) - (a.group.archivedAt ?? 0)),
      );
    });

    return () => {
      cancelled = true;
    };
  }, [workspaceId, groups]);

  return (
    <div className="border-t mt-auto">
      <button
        className="w-full flex items-center gap-1.5 py-2 px-3 text-xs text-muted-foreground hover:bg-muted/40 transition-colors"
        onClick={() => setCollapsed((value) => !value)}
      >
        {collapsed ? <ChevronRight className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        <Archive className="w-3.5 h-3.5" />
        已归档话题
        <span className="ml-auto opacity-70">{topics.length}</span>
      </button>
      {!collapsed && topics.map(({ group, conversations }) => (
        <GroupCard
          key={group.id}
          group={group}
          conversations={conversations}
          mode="archived"
        />
      ))}
    </div>
  );
}
