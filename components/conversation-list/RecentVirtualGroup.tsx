import React, { useMemo, useState } from 'react';
import { Zap, ChevronDown, ChevronRight } from 'lucide-react';
import { useConversationStore } from '@/stores/conversation-store';
import { RECENT_THRESHOLD_MS } from './utils';
import { ConversationRow } from './ConversationRow';

export function RecentVirtualGroup() {
  const conversations = useConversationStore((s) => s.conversations);
  const [collapsed, setCollapsed] = useState(false);

  const recent = useMemo(() => {
    const now = Date.now();
    return conversations
      .filter((c) => !c.archived_at && now - (c.updated_at ?? c.created_at) <= RECENT_THRESHOLD_MS)
      .sort((a, b) => b.updated_at - a.updated_at);
  }, [conversations]);

  if (recent.length === 0) return null;

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
        <Zap className="w-3 h-3 text-yellow-500" />
        <span>近期（&lt; 5 天）</span>
        <span className="ml-auto text-[10px] opacity-70">{recent.length}</span>
      </div>
      {!collapsed && recent.map((conv) => (
        <ConversationRow key={conv.id} conv={conv} nodeId={`conv:${conv.id}::recent`} indent={20} />
      ))}
    </div>
  );
}
