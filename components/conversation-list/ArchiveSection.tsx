import { useEffect, useState } from 'react';
import { Archive } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
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
  const [open, setOpen] = useState(false);
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
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <button className="w-full flex items-center gap-1.5 py-2 px-3 text-xs text-muted-foreground hover:bg-muted/40 transition-colors">
            <Archive className="w-3.5 h-3.5" />
            已归档话题
            <span className="ml-auto opacity-70">{topics.length}</span>
          </button>
        </DialogTrigger>
        <DialogContent className="sm:max-w-md p-0 gap-0">
          <DialogHeader className="px-6 pt-6 pb-3">
            <DialogTitle className="text-sm">已归档话题</DialogTitle>
          </DialogHeader>
          <ScrollArea className="max-h-[60vh] px-2 pb-4">
            {topics.length === 0 ? (
              <div className="px-3 py-8 text-center text-xs text-muted-foreground">
                暂无归档话题
              </div>
            ) : (
              topics.map(({ group, conversations }) => (
                <GroupCard
                  key={group.id}
                  group={group}
                  conversations={conversations}
                  mode="archived"
                />
              ))
            )}
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </div>
  );
}
