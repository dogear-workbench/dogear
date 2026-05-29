import { useState } from 'react';
import { RotateCcw } from 'lucide-react';
import type { ConversationUsage, CompactMarker } from '@/types/usage';
import { formatTokens } from './usage-utils';
import { UsageEntryRow } from './UsageEntryRow';

type Item =
  | { kind: 'entry'; sortKey: number; entry: ConversationUsage['entries'][number] }
  | { kind: 'compact'; sortKey: number; marker: CompactMarker };

function buildItems(usage: ConversationUsage): Item[] {
  const items: Item[] = [
    ...usage.entries.map(e => ({ kind: 'entry' as const, sortKey: e.turnIndex, entry: e })),
    // marker 排在它所在轮次之后（更新一侧），故 +0.5
    ...usage.compactMarkers.map(m => ({ kind: 'compact' as const, sortKey: m.afterTurnIndex + 0.5, marker: m })),
  ];
  return items.sort((a, b) => b.sortKey - a.sortKey);
}

export function UsageEntryList({ usage }: { usage: ConversationUsage }) {
  const [expanded, setExpanded] = useState(false);
  const items = buildItems(usage);
  const visible = expanded ? items : items.slice(0, 5);

  return (
    <div className="p-3 space-y-1">
      <div className="flex items-center justify-between mb-1">
        <span className="text-muted-foreground">最近明细</span>
        {items.length > 5 && (
          <button
            type="button"
            onClick={() => setExpanded(e => !e)}
            className="text-muted-foreground hover:text-foreground"
          >
            {expanded ? '收起 ▴' : `全部 ${usage.entries.length} 条 ▾`}
          </button>
        )}
      </div>
      <div className={expanded ? 'max-h-64 overflow-y-auto space-y-1 pr-1' : 'space-y-1'}>
        {visible.map(item =>
          item.kind === 'entry' ? (
            <UsageEntryRow key={`e-${item.entry.uuid}`} entry={item.entry} />
          ) : (
            <CompactRow key={`c-${item.marker.uuid}`} marker={item.marker} />
          ),
        )}
      </div>
    </div>
  );
}

function CompactRow({ marker }: { marker: CompactMarker }) {
  return (
    <div className="flex items-center gap-1.5 py-0.5 text-muted-foreground">
      <RotateCcw size={12} className="shrink-0" />
      <span>
        {marker.trigger === 'manual' ? '手动压缩' : '自动压缩'}
        {marker.preTokens > 0 && `（${formatTokens(marker.preTokens)} → 压缩后）`}
      </span>
    </div>
  );
}
