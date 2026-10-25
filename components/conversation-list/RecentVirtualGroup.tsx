import React, { useCallback, useMemo } from 'react';
import { Zap, History } from 'lucide-react';
import { useGroupStore } from '@/stores/group-store';
import { useConversationStore, visibleConversationsOf } from '@/stores/conversation-store';
import { useSectionCollapseStore } from '@/stores/section-collapse-store';
import { useSessionStore } from '@/stores/session-store';
import { RECENT_THRESHOLD_MS, OLDER_THRESHOLD_MS, RECENT_DAYS, OLDER_DAYS, ancestorChainIds } from './utils';
import { GroupCard } from '@/components/group-list/GroupCard';
import { ListSectionHeader } from '@/components/ui/list-section-header';
import { buildConversationTree } from '@/lib/conversation-sort';
import type { Conversation } from '@/components/ConversationList';
import type { Group } from '@/types/group';

function useSortedBuckets(): { recent: Group[]; older: Group[] } {
  const groups = useGroupStore((s) => s.groups);
  return useMemo(() => {
    const now = Date.now();
    const visible = groups.filter((g) => g.hidden !== true);
    const sorted = [...visible].sort((a, b) => b.updatedAt - a.updatedAt);
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
  const lastBumpById = useConversationStore((s) => s.lastBumpById);
  const visibleConversations = useMemo(() => visibleConversationsOf(conversations), [conversations]);
  const { recent, older } = useSortedBuckets();
  const recentExpanded = useSectionCollapseStore((s) => s.recentExpanded);
  const toggleRecent = useSectionCollapseStore((s) => s.toggleRecent);
  const olderExpanded = useSectionCollapseStore((s) => s.olderExpanded);
  const toggleOlder = useSectionCollapseStore((s) => s.toggleOlder);

  const convIdsByGroup = useMemo(() => {
    const map = new Map<string, Conversation[]>();
    for (const c of visibleConversations) {
      if (!c.groupId) continue;
      const list = map.get(c.groupId) ?? [];
      list.push(c);
      map.set(c.groupId, list);
    }
    return map;
  }, [conversations]);

  // 一键收起：仅保留活跃会话所在组展开（含其祖先链），并确保该组所在时间分区可见
  const handleCollapse = useCallback(() => {
    const activeTabId = useSessionStore.getState().activeTabId;
    const convs = useConversationStore.getState().conversations;
    const activeConv = activeTabId ? convs.find((c) => c.id === activeTabId) : undefined;
    const activeGroupId = activeConv?.groupId ?? null;
    useGroupStore.getState().collapseAllExcept(activeGroupId);
    if (!activeConv || !activeGroupId) return;
    const collapse = useSectionCollapseStore.getState();
    for (const id of ancestorChainIds(activeConv, convs)) collapse.expandSubConv(id);
    void collapse.revealTopic(activeGroupId);
  }, []);

  if (recent.length === 0 && older.length === 0) return null;

  return (
    <div>
      {recent.length > 0 && (
        <div>
          <ListSectionHeader
            icon={Zap}
            iconClassName="w-3 h-3 text-yellow-500"
            label={`近期（< ${RECENT_DAYS} 天）`}
            count={recent.length}
            expanded={recentExpanded}
            onToggle={toggleRecent}
            onCollapse={handleCollapse}
          />
          {recentExpanded && recent.map((group) => (
            <GroupCard
              key={group.id}
              group={group}
              tree={buildConversationTree(convIdsByGroup.get(group.id) ?? [], lastBumpById)}
            />
          ))}
        </div>
      )}
      {older.length > 0 && (
        <div>
          <ListSectionHeader
            icon={History}
            iconClassName="w-3 h-3 text-muted-foreground"
            label={`更早（${RECENT_DAYS}~${OLDER_DAYS} 天）`}
            count={older.length}
            expanded={olderExpanded}
            onToggle={toggleOlder}
            onCollapse={handleCollapse}
          />
          {olderExpanded && older.map((group) => (
            <GroupCard
              key={group.id}
              group={group}
              tree={buildConversationTree(convIdsByGroup.get(group.id) ?? [], lastBumpById)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
