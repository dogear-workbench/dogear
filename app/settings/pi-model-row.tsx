/**
 * 模型行：两行卡片（第一行 ID/显示名/删除，第二行徽标组）
 */
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Trash2, Eye } from 'lucide-react';
import { cn } from '@/lib/utils';
import { EffortSelector } from '@/components/EffortSelector';
import { buildEntry, MaxBadge, PricingBadge, WindowBadge, type PiModelEntry } from './pi-model-badges';

export type { PiModelEntry } from './pi-model-badges';

interface PiModelRowProps {
  entry: PiModelEntry;
  others: PiModelEntry[];
  onChange: (next: PiModelEntry) => void;
  onRemove: () => void;
}

export function PiModelRow({ entry, others, onChange, onRemove }: PiModelRowProps) {
  const [idDraft, setIdDraft] = useState(entry.id);
  const [idError, setIdError] = useState(false);

  const commitId = () => {
    const next = idDraft.trim();
    if (next === entry.id) {
      setIdDraft(entry.id);
      return;
    }
    if (!next || others.some(o => o.id === next)) {
      setIdDraft(entry.id);
      setIdError(true);
      window.setTimeout(() => setIdError(false), 1500);
      return;
    }
    onChange(buildEntry(next, entry.label, entry.contextWindow, entry.maxTokens, entry.pricing, entry.supportsVision, entry.effort));
  };

  return (
    <div className="border rounded-lg p-3 bg-card">
      <div className="flex items-center gap-2 mb-2">
        <input
          type="text"
          spellCheck={false}
          className={cn(
            'h-9 flex-1 min-w-0 text-sm font-mono px-3 border rounded-md bg-muted/30 focus:outline-none focus:ring-1 focus:ring-ring',
            idError && 'border-destructive ring-1 ring-destructive',
          )}
          value={idDraft}
          onChange={(e) => {
            setIdError(false);
            setIdDraft(e.target.value);
          }}
          onBlur={commitId}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commitId();
            } else if (e.key === 'Escape') {
              e.preventDefault();
              setIdDraft(entry.id);
            }
          }}
        />
        <input
          type="text"
          className="h-9 w-40 shrink-0 px-3 text-sm border rounded-md bg-background focus:outline-none focus:ring-1 focus:ring-ring"
          value={entry.label ?? ''}
          placeholder="显示名"
          onChange={(e) => {
            const v = e.target.value;
            onChange(buildEntry(entry.id, v === '' ? undefined : v, entry.contextWindow, entry.maxTokens, entry.pricing, entry.supportsVision, entry.effort));
          }}
        />
        <Button variant="ghost" size="sm" onClick={onRemove} aria-label={`删除模型 ${entry.id}`}>
          <Trash2 className="w-4 h-4 text-destructive" />
        </Button>
      </div>
      <div className="flex items-center flex-wrap gap-1.5">
        <WindowBadge entry={entry} onChange={onChange} />
        <MaxBadge entry={entry} onChange={onChange} />
        <PricingBadge entry={entry} onChange={onChange} />
        <button
          type="button"
          title={entry.supportsVision ? '已标记为视觉模型：用户消息图片可直接进入上下文；点击取消标记' : '标记为视觉模型（可识图）；无标记的模型收到图片时会自动转派识图模型'}
          className={cn(
            'shrink-0 flex items-center gap-1 text-xs px-2 py-1 rounded border transition-colors',
            entry.supportsVision
              ? 'text-emerald-700 dark:text-emerald-300 border-emerald-300 dark:border-emerald-700 hover:bg-emerald-50 dark:hover:bg-emerald-950'
              : 'text-muted-foreground hover:bg-muted/50',
          )}
          onClick={() => onChange(buildEntry(entry.id, entry.label, entry.contextWindow, entry.maxTokens, entry.pricing, entry.supportsVision ? undefined : true, entry.effort))}
        >
          <Eye className="w-3 h-3" />
          {entry.supportsVision ? '视觉' : '无视觉'}
        </button>
        <EffortSelector
          variant="inline"
          allowUnset={false}
          value={entry.effort ?? null}
          onChange={(v) => onChange(buildEntry(entry.id, entry.label, entry.contextWindow, entry.maxTokens, entry.pricing, entry.supportsVision, v == null || v === 'off' ? undefined : v))}
        />
      </div>
    </div>
  );
}
