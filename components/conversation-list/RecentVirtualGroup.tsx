import React, { useMemo } from 'react';
import { Zap, History, ChevronDown, ChevronRight, type LucideIcon } from 'lucide-react';
import { useGroupStore } from '@/stores/group-store';
import { useConversationStore } from '@/stores/conversation-store';
import { useSectionCollapseStore } from '@/stores/section-collapse-store';
import { RECENT_THRESHOLD_MS, OLDER_THRESHOLD_MS, RECENT_DAYS, OLDER_DAYS } from './utils';
import { GroupCard } from '@/components/group-list/GroupCard';
import { buildConversationTree } from '@/lib/conversation-sort';
import type { Group } from '@/types/group';

function SectionHeader({
  icon: Icon,
  iconClassName,
  label,
  count,
  expanded,
  onToggle,
}: {
  icon: LucideIcon;
  iconClassName: string;
  label: string;
  count: number;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <div
      className="flex items-center gap-1.5 py-1.5 px-3 cursor-pointer select-none text-[11px] font-semibold tracking-wider text-muted-foreground hover:bg-muted/40 hover:text-foreground transition-colors"
      onClick={onToggle}
    >
      {expanded
        ? <ChevronDown className="w-3 h-3" />
        : <ChevronRight className="w-3 h-3" />
      }
      <Icon className={iconClassName} />
      <span>{label}</span>
      <span className="ml-auto text-[10px] opacity-70">{count}</span>
    </div>
  );
}

function useSortedBuckets(): { recent: Group[]; older: Group[] } {
  const groups = useGroupStore((s) => s.groups);
  return useMemo(() => {
    const now = Date.now();
    const sorted = [...groups].sort((a, b) => b.updatedAt - a.updatedAt);
    return {
      recent: sorted.filter((g) => now - g.updatedAt <= RECENT_THRESHOLD_MS),
      older: sorted.filter((g) => {
        const age = now - g.updatedAt;
        return age > RECENT_THRESHOLD_MS && age <= OLDER_THRESHOLD_MS;
      }),
    };
  }, [groups]);
}

export function RecentVirtualGroup() {
  const conversations = useConversationStore((s) => s.conversations);
  const { recent, older } = useSortedBuckets();
  const recentExpanded = useSectionCollapseStore((s) => s.recentExpanded);
  const toggleRecent = useSectionCollapseStore((s) => s.toggleRecent);
  const olderExpanded = useSectionCollapseStore((s) => s.olderExpanded);
  const toggleOlder = useSectionCollapseStore((s) => s.toggleOlder);

  if (recent.length === 0 && older.length === 0) return null;

  return (
    <div>
      {recent.length > 0 && (
        <div>
          <SectionHeader
            icon={Zap}
            iconClassName="w-3 h-3 text-yellow-500"
            label={`近期（< ${RECENT_DAYS} 天）`}
            count={recent.length}
            expanded={recentExpanded}
            onToggle={toggleRecent}
          />
          {recentExpanded && recent.map((group) => (
            <GroupCard
              key={group.id}
              group={group}
              tree={buildConversationTree(conversations.filter((c) => c.groupId === group.id))}
            />
          ))}
        </div>
      )}
      {older.length > 0 && (
        <div>
          <SectionHeader
            icon={History}
            iconClassName="w-3 h-3 text-muted-foreground"
            label={`更早（${RECENT_DAYS}~${OLDER_DAYS} 天）`}
            count={older.length}
            expanded={olderExpanded}
            onToggle={toggleOlder}
          />
          {olderExpanded && older.map((group) => (
            <GroupCard
              key={group.id}
              group={group}
              tree={buildConversationTree(conversations.filter((c) => c.groupId === group.id))}
            />
          ))}
        </div>
      )}
    </div>
  );
}
