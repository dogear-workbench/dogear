import React, { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useConversationStore } from '@/stores/conversation-store';
import type { Conversation } from '@/components/ConversationList';
import { TIME_BUCKET_THRESHOLD_MS } from './utils';
import { RecentVirtualGroup } from './RecentVirtualGroup';
import { ConversationRow } from './ConversationRow';

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
  const conversations = useConversationStore((s) => s.conversations);
  const [earlierCollapsed, setEarlierCollapsed] = useState(true);
  const [recentMidCollapsed, setRecentMidCollapsed] = useState(false);

  // 过滤归档 + 拆 30 天 / 更早
  // 注意：< 5 天的也归到「30天内」，因为 RecentVirtualGroup 只是虚拟视图（不从底下分组扣除）
  const { recentMid, earlier } = useMemo(() => {
    const now = Date.now();
    const mid: Conversation[] = [];
    const old: Conversation[] = [];
    for (const c of conversations) {
      if (c.archived_at) continue;
      const age = now - (c.updated_at ?? c.created_at);
      if (age <= TIME_BUCKET_THRESHOLD_MS) mid.push(c);
      else old.push(c);
    }
    mid.sort((a, b) => b.updated_at - a.updated_at);
    old.sort((a, b) => b.updated_at - a.updated_at);
    return { recentMid: mid, earlier: old };
  }, [conversations]);

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
          {!recentMidCollapsed && recentMid.map((c) => (
            <ConversationRow key={c.id} conv={c} indent={20} />
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
          {!earlierCollapsed && earlier.map((c) => (
            <ConversationRow key={c.id} conv={c} indent={20} />
          ))}
        </>
      )}
    </div>
  );
}
