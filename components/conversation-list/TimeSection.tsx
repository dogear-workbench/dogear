import React, { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useGroupStore } from '@/stores/group-store';
import { useConversationStore } from '@/stores/conversation-store';
import type { Group } from '@/types/group';
import { RECENT_THRESHOLD_MS, TIME_BUCKET_THRESHOLD_MS } from './utils';
import { RecentVirtualGroup } from './RecentVirtualGroup';
import { GroupCard } from '@/components/group-list/GroupCard';
import { sortConversationsWithDFS } from '@/lib/conversation-sort';

function GroupHeader({
  label,
  count,
  collapsed,
  onToggle,
}: {
  label: string;
  count: number;
  collapsed: boolean;
  onToggle: () => void;
}) {
  return (
    <div
      className="flex items-center gap-1.5 py-1.5 px-3 cursor-pointer select-none text-xs font-medium text-muted-foreground hover:bg-muted/40 transition-colors"
      onClick={onToggle}
    >
      {collapsed
        ? <ChevronRight className="w-3 h-3" />
        : <ChevronDown className="w-3 h-3" />
      }
      <span>{label}</span>
      <span className="ml-auto text-[10px] opacity-70">{count}</span>
    </div>
  );
}

export function TimeSection() {
  const groups = useGroupStore((s) => s.groups);
  const conversations = useConversationStore((s) => s.conversations);
  const [earlierCollapsed, setEarlierCollapsed] = useState(true);
  const [recentMidCollapsed, setRecentMidCollapsed] = useState(false);

  // < 5 天交给 RecentVirtualGroup；5-30 天进 mid；> 30 天进 earlier
  const { recentMid, earlier } = useMemo(() => {
    const now = Date.now();
    const mid: Group[] = [];
    const old: Group[] = [];
    for (const g of groups) {
      const age = now - g.updatedAt;
      if (age <= RECENT_THRESHOLD_MS) continue;
      if (age <= TIME_BUCKET_THRESHOLD_MS) mid.push(g);
      else old.push(g);
    }
    mid.sort((a, b) => b.updatedAt - a.updatedAt);
    old.sort((a, b) => b.updatedAt - a.updatedAt);
    return { recentMid: mid, earlier: old };
  }, [groups]);

  const convsOf = (groupId: string) =>
    sortConversationsWithDFS(conversations.filter((c) => c.groupId === groupId));

  return (
    <div>
      <RecentVirtualGroup />
      {recentMid.length > 0 && (
        <>
          <GroupHeader
            label="30 天内"
            count={recentMid.length}
            collapsed={recentMidCollapsed}
            onToggle={() => setRecentMidCollapsed((v) => !v)}
          />
          {!recentMidCollapsed && recentMid.map((g) => (
            <GroupCard key={g.id} group={g} conversations={convsOf(g.id)} />
          ))}
        </>
      )}
      {earlier.length > 0 && (
        <>
          <GroupHeader
            label="更早"
            count={earlier.length}
            collapsed={earlierCollapsed}
            onToggle={() => setEarlierCollapsed((v) => !v)}
          />
          {!earlierCollapsed && earlier.map((g) => (
            <GroupCard key={g.id} group={g} conversations={convsOf(g.id)} />
          ))}
        </>
      )}
    </div>
  );
}
