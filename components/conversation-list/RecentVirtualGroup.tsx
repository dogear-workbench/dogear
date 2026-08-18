import React, { useMemo } from 'react';
import { Zap, ChevronDown, ChevronRight } from 'lucide-react';
import { useGroupStore } from '@/stores/group-store';
import { useConversationStore } from '@/stores/conversation-store';
import { useSectionCollapseStore } from '@/stores/section-collapse-store';
import { RECENT_THRESHOLD_MS } from './utils';
import { GroupCard } from '@/components/group-list/GroupCard';
import { sortConversationsWithDFS } from '@/lib/conversation-sort';

export function RecentVirtualGroup() {
  const groups = useGroupStore((s) => s.groups);
  const conversations = useConversationStore((s) => s.conversations);
  const expanded = useSectionCollapseStore((s) => s.recentExpanded);
  const toggleExpanded = useSectionCollapseStore((s) => s.toggleRecent);

  const recent = useMemo(() => {
    const now = Date.now();
    return groups
      .filter((g) => now - g.updatedAt <= RECENT_THRESHOLD_MS)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }, [groups]);

  if (recent.length === 0) return null;

  return (
    <div>
      <div
        className="flex items-center gap-1.5 py-1.5 px-3 cursor-pointer select-none text-xs font-semibold text-foreground hover:bg-muted/40 transition-colors"
        onClick={() => toggleExpanded()}
      >
        {expanded
          ? <ChevronDown className="w-3 h-3" />
          : <ChevronRight className="w-3 h-3" />
        }
        <Zap className="w-3 h-3 text-yellow-500" />
        <span>近期（&lt; 5 天）</span>
        <span className="ml-auto text-[10px] opacity-70">{recent.length}</span>
      </div>
      {expanded && recent.map((group) => (
        <GroupCard
          key={group.id}
          group={group}
          conversations={sortConversationsWithDFS(conversations.filter((c) => c.groupId === group.id))}
        />
      ))}
    </div>
  );
}
