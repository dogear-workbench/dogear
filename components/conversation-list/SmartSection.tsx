import React, { useEffect, useMemo } from 'react';
import { Tag, ChevronDown, ChevronRight } from 'lucide-react';
import { useSmartCategoryStore } from '@/stores/smart-category-store';
import { useGroupStore } from '@/stores/group-store';
import { useConversationStore } from '@/stores/conversation-store';
import type { SmartCategory } from '@/types/smart-category';
import type { Group } from '@/types/group';
import type { Conversation } from '@/components/ConversationList';
import { GroupCard } from '@/components/group-list/GroupCard';
import { buildConversationTree } from '@/lib/conversation-sort';
import { useSectionCollapseStore } from '@/stores/section-collapse-store';

interface SmartSectionProps {
  workspaceId: string;
}

export function SmartSection({ workspaceId }: SmartSectionProps) {
  const categories = useSmartCategoryStore((s) => s.categories);
  const loading = useSmartCategoryStore((s) => s.loading);
  const load = useSmartCategoryStore((s) => s.load);
  const groups = useGroupStore((s) => s.groups);
  const conversations = useConversationStore((s) => s.conversations);

  useEffect(() => {
    if (workspaceId) load(workspaceId);
  }, [workspaceId, load]);

  const visible = useMemo(
    () => categories
      .filter((c) => c.groupIds.length > 0)
      .sort((a, b) => b.groupIds.length - a.groupIds.length),
    [categories]
  );

  const groupById = useMemo(() => {
    const m = new Map<string, Group>();
    for (const g of groups) m.set(g.id, g);
    return m;
  }, [groups]);

  return (
    <div>
      {visible.map((cat) => (
        <CategoryGroup key={cat.id} cat={cat} groupById={groupById} conversations={conversations} />
      ))}
      {!loading && visible.length === 0 && (
        <div className="px-3 py-6 text-center text-xs text-muted-foreground">
          暂无分类。提炼会话后会自动生成。
        </div>
      )}
    </div>
  );
}

function CategoryGroup({
  cat,
  groupById,
  conversations,
}: {
  cat: SmartCategory;
  groupById: Map<string, Group>;
  conversations: Conversation[];
}) {
  const expanded = useSectionCollapseStore((s) => s.expandedSmartCategoryIds.has(cat.id));
  const toggleExpanded = useSectionCollapseStore((s) => s.toggleSmartCategory);

  const groupsInCat = useMemo(() => {
    return cat.groupIds
      .map((id) => groupById.get(id))
      .filter((g): g is Group => !!g)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }, [cat.groupIds, groupById]);

  if (groupsInCat.length === 0) return null;

  return (
    <div>
      <div
        className="flex items-center gap-1.5 py-1.5 px-3 cursor-pointer select-none text-xs font-semibold text-foreground hover:bg-muted/40 transition-colors"
        onClick={() => toggleExpanded(cat.id)}
      >
        {expanded
          ? <ChevronDown className="w-3 h-3" />
          : <ChevronRight className="w-3 h-3" />
        }
        <Tag className="w-3 h-3 text-sky-500" />
        <span className="truncate">{cat.name}</span>
        <span className="ml-auto text-[10px] opacity-70">{groupsInCat.length}</span>
      </div>
      {expanded && groupsInCat.map((g) => (
        <GroupCard
          key={`${cat.id}:${g.id}`}
          group={g}
          tree={buildConversationTree(conversations.filter((c) => c.groupId === g.id))}
        />
      ))}
    </div>
  );
}
