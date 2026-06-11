import React, { useEffect, useState } from 'react';
import { Archive, ChevronDown, ChevronRight } from 'lucide-react';
import { client } from '@/lib/client';
import { ConversationRow } from './ConversationRow';
import type { Conversation } from '@/components/ConversationList';

interface ArchiveSectionProps {
  workspaceId: string;
}

export function ArchiveSection({ workspaceId }: ArchiveSectionProps) {
  const [collapsed, setCollapsed] = useState(true);
  const [archived, setArchived] = useState<Conversation[]>([]);

  useEffect(() => {
    if (collapsed || !workspaceId) return;
    let cancelled = false;
    client.listArchivedConversations({ workspaceId }).then((r) => {
      if (!cancelled && !r.error) setArchived(r.conversations as Conversation[]);
    });
    return () => {
      cancelled = true;
    };
  }, [collapsed, workspaceId]);

  return (
    <div className="border-t mt-auto">
      <button
        className="w-full flex items-center gap-1.5 py-2 px-3 text-xs text-muted-foreground hover:bg-muted/40 transition-colors"
        onClick={() => setCollapsed((v) => !v)}
      >
        {collapsed ? <ChevronRight className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        <Archive className="w-3.5 h-3.5" />
        归档
        {!collapsed && (
          <span className="ml-auto opacity-70">{archived.length}</span>
        )}
      </button>
      {!collapsed && archived.map((c) => (
        <ConversationRow
          key={c.id}
          conv={c}
          nodeId={`conv:${c.id}::archive`}
          archived
          indent={16}
        />
      ))}
    </div>
  );
}
