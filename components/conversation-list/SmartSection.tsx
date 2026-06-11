import React, { useEffect, useMemo, useState } from 'react';
import { Tag, ChevronDown, ChevronRight } from 'lucide-react';
import { useSmartCategoryStore } from '@/stores/smart-category-store';
import { useConversationStore } from '@/stores/conversation-store';
import type { SmartCategory } from '@/types/smart-category';
import type { Conversation } from '@/components/ConversationList';
import { RecentVirtualGroup } from './RecentVirtualGroup';
import { ConversationRow } from './ConversationRow';

interface SmartSectionProps {
  workspaceId: string;
}

export function SmartSection({ workspaceId }: SmartSectionProps) {
  const categories = useSmartCategoryStore((s) => s.categories);
  const loading = useSmartCategoryStore((s) => s.loading);
  const load = useSmartCategoryStore((s) => s.load);
  const conversations = useConversationStore((s) => s.conversations);

  useEffect(() => {
    if (workspaceId) load(workspaceId);
  }, [workspaceId, load]);

  // 按 conversationIds.length 倒序，空分类隐藏
  const visible = useMemo(
    () => categories
      .filter((c) => c.conversationIds.length > 0)
      .sort((a, b) => b.conversationIds.length - a.conversationIds.length),
    [categories]
  );

  const convById = useMemo(() => {
    const m = new Map<string, Conversation>();
    for (const c of conversations) m.set(c.id, c);
    return m;
  }, [conversations]);

  return (
    <div>
      <RecentVirtualGroup />
      {visible.map((cat) => (
        <CategoryGroup key={cat.id} cat={cat} convById={convById} />
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
  convById,
}: {
  cat: SmartCategory;
  convById: Map<string, Conversation>;
}) {
  const [collapsed, setCollapsed] = useState(false);

  const convs = useMemo(() => {
    return cat.conversationIds
      .map((id) => convById.get(id))
      .filter((c): c is Conversation => !!c && !c.archived_at)
      .sort((a, b) => b.updated_at - a.updated_at);
  }, [cat.conversationIds, convById]);

  if (convs.length === 0) return null;

  return (
    <div>
      <div
        className="flex items-center gap-1.5 py-1.5 px-3 cursor-pointer select-none text-xs font-medium text-muted-foreground hover:bg-muted/40 transition-colors"
        onClick={() => setCollapsed((v) => !v)}
      >
        {collapsed
          ? <ChevronRight className="w-3 h-3" />
          : <ChevronDown className="w-3 h-3" />
        }
        <Tag className="w-3 h-3" />
        <span className="truncate">{cat.name}</span>
        <span className="ml-auto text-[10px] opacity-70">{convs.length}</span>
      </div>
      {!collapsed && convs.map((c) => (
        <ConversationRow
          key={`${cat.id}:${c.id}`}
          conv={c}
          nodeId={`conv:${c.id}::smart::${cat.id}`}
          indent={20}
        />
      ))}
    </div>
  );
}
