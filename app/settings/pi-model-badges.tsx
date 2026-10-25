/**
 * 模型行徽标：窗口 / 输出上限 / 价格，各自内聚编辑态
 */
import { useRef, useState } from 'react';
import {
  FALLBACK_CONTEXT_WINDOW,
  FALLBACK_MAX_TOKENS,
  formatContextLabel,
  lookupContextWindow,
  lookupMaxTokens,
  lookupPricing,
  parseContextInput,
} from '@/lib/pi-model-catalog';
import type { EffortLevel, ModelPricing } from '@/types/settings';

export interface PiModelEntry {
  id: string;
  label?: string;
  contextWindow?: number;
  maxTokens?: number;
  pricing?: ModelPricing;
  supportsVision?: boolean;
  effort?: EffortLevel | null;
}

export function buildEntry(
  id: string, label: string | undefined, contextWindow: number | undefined, maxTokens: number | undefined,
  pricing: ModelPricing | undefined, supportsVision: boolean | undefined, effort: EffortLevel | null | undefined,
): PiModelEntry {
  const next: PiModelEntry = { id };
  if (label) next.label = label;
  if (contextWindow !== undefined) next.contextWindow = contextWindow;
  if (maxTokens !== undefined) next.maxTokens = maxTokens;
  if (pricing !== undefined) next.pricing = pricing;
  if (supportsVision !== undefined) next.supportsVision = supportsVision;
  if (effort !== undefined) next.effort = effort;
  return next;
}

interface BadgeProps {
  entry: PiModelEntry;
  onChange: (next: PiModelEntry) => void;
}

export function WindowBadge({ entry, onChange }: BadgeProps) {
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState(false);
  const cancelled = useRef(false);
  const catalogWindow = lookupContextWindow(entry.id);

  const commit = () => {
    const raw = draft.trim();
    if (raw === '') {
      if (entry.contextWindow !== undefined) onChange(buildEntry(entry.id, entry.label, undefined, entry.maxTokens, entry.pricing, entry.supportsVision, entry.effort));
    } else {
      const parsed = parseContextInput(raw);
      if (parsed !== undefined && parsed !== entry.contextWindow) {
        onChange(buildEntry(entry.id, entry.label, parsed, entry.maxTokens, entry.pricing, entry.supportsVision, entry.effort));
      }
    }
    setEditing(false);
  };

  if (editing) {
    return (
      <input
        type="text"
        autoFocus
        spellCheck={false}
        className="h-9 w-28 shrink-0 px-2 text-xs tabular-nums border rounded-md bg-background focus:outline-none focus:ring-1 focus:ring-ring"
        value={draft}
        placeholder="1M / 200K / 262144"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          if (!cancelled.current) commit();
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            cancelled.current = true;
            setEditing(false);
          }
        }}
      />
    );
  }

  return (
    <button
      type="button"
      title="点击手填上下文窗口"
      className={
        'shrink-0 text-xs tabular-nums px-2 py-1 rounded border transition-colors ' +
        (entry.contextWindow !== undefined
          ? 'text-blue-700 dark:text-blue-300 border-blue-300 dark:border-blue-700 hover:bg-blue-50 dark:hover:bg-blue-950'
          : catalogWindow !== undefined
            ? 'text-muted-foreground hover:bg-muted/50'
            : 'text-yellow-700 dark:text-yellow-300 border-yellow-300 dark:border-yellow-700 hover:bg-yellow-50 dark:hover:bg-yellow-950')
      }
      onClick={() => {
        setDraft(entry.contextWindow !== undefined ? String(entry.contextWindow) : '');
        cancelled.current = false;
        setEditing(true);
      }}
    >
      {entry.contextWindow !== undefined
        ? `窗口 ${formatContextLabel(entry.contextWindow)} · 手动`
        : catalogWindow !== undefined
          ? `窗口 ${formatContextLabel(catalogWindow)}`
          : `窗口 ${formatContextLabel(FALLBACK_CONTEXT_WINDOW)} · 未识别`}
    </button>
  );
}

export function MaxBadge({ entry, onChange }: BadgeProps) {
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState(false);
  const cancelled = useRef(false);
  const catalogMax = lookupMaxTokens(entry.id);

  const commit = () => {
    const raw = draft.trim();
    if (raw === '') {
      if (entry.maxTokens !== undefined) onChange(buildEntry(entry.id, entry.label, entry.contextWindow, undefined, entry.pricing, entry.supportsVision, entry.effort));
    } else {
      const parsed = parseContextInput(raw);
      if (parsed !== undefined && parsed !== entry.maxTokens) {
        onChange(buildEntry(entry.id, entry.label, entry.contextWindow, parsed, entry.pricing, entry.supportsVision, entry.effort));
      }
    }
    setEditing(false);
  };

  if (editing) {
    return (
      <input
        type="text"
        autoFocus
        spellCheck={false}
        className="h-9 w-24 shrink-0 px-2 text-xs tabular-nums border rounded-md bg-background focus:outline-none focus:ring-1 focus:ring-ring"
        value={draft}
        placeholder="8192 / 32K"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          if (!cancelled.current) commit();
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            cancelled.current = true;
            setEditing(false);
          }
        }}
      />
    );
  }

  return (
    <button
      type="button"
      title="点击设置单次请求输出上限（thinking 与正文共享额度）；留空回落目录默认 / 8192"
      className={
        'shrink-0 text-xs tabular-nums px-2 py-1 rounded border transition-colors ' +
        (entry.maxTokens !== undefined
          ? 'text-blue-700 dark:text-blue-300 border-blue-300 dark:border-blue-700 hover:bg-blue-50 dark:hover:bg-blue-950'
          : 'text-muted-foreground hover:bg-muted/50')
      }
      onClick={() => {
        setDraft(entry.maxTokens !== undefined ? String(entry.maxTokens) : '');
        cancelled.current = false;
        setEditing(true);
      }}
    >
      {entry.maxTokens !== undefined
        ? `输出 ≤${formatContextLabel(entry.maxTokens)} · 手动`
        : catalogMax !== undefined
          ? `输出 ≤${formatContextLabel(catalogMax)}`
          : `输出 ≤${formatContextLabel(FALLBACK_MAX_TOKENS)} · 默认`}
    </button>
  );
}

const PRICING_FIELDS = ['input', 'output', 'cacheRead'] as const;
type PricingField = (typeof PRICING_FIELDS)[number];

const PRICING_FIELD_TITLES: Record<PricingField, string> = {
  input: '输入价（元/百万 tokens）',
  output: '输出价（元/百万 tokens）',
  cacheRead: '缓存命中价（元/百万 tokens）',
};

export function PricingBadge({ entry, onChange }: BadgeProps) {
  const [draft, setDraft] = useState<Record<PricingField, string>>({ input: '', output: '', cacheRead: '' });
  const [editing, setEditing] = useState(false);
  const cancelled = useRef(false);
  const catalogPricing = lookupPricing(entry.id);

  const commit = () => {
    if (cancelled.current) return;
    const raws = Object.fromEntries(PRICING_FIELDS.map(f => [f, draft[f].trim()])) as Record<PricingField, string>;
    if (PRICING_FIELDS.every(f => raws[f] === '')) {
      if (entry.pricing !== undefined) onChange(buildEntry(entry.id, entry.label, entry.contextWindow, entry.maxTokens, undefined, entry.supportsVision, entry.effort));
    } else {
      const merged = {} as Record<PricingField, number>;
      let valid = true;
      for (const f of PRICING_FIELDS) {
        if (raws[f] !== '') {
          if (/^\d+(\.\d+)?$/.test(raws[f])) merged[f] = parseFloat(raws[f]);
          else { valid = false; break; }
        } else if (catalogPricing !== undefined) {
          merged[f] = catalogPricing[f];
        } else {
          valid = false;
          break;
        }
      }
      if (valid) {
        const unchanged = entry.pricing !== undefined && PRICING_FIELDS.every(f => entry.pricing![f] === merged[f]);
        if (!unchanged) {
          onChange(buildEntry(entry.id, entry.label, entry.contextWindow, entry.maxTokens, { input: merged.input, output: merged.output, cacheRead: merged.cacheRead }, entry.supportsVision, entry.effort));
        }
      }
    }
    setEditing(false);
  };

  if (editing) {
    return (
      <div
        className="flex items-center gap-1 shrink-0"
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) commit();
        }}
      >
        <span className="text-xs text-muted-foreground">¥</span>
        {PRICING_FIELDS.map((f, i) => (
          <input
            key={f}
            type="text"
            autoFocus={i === 0}
            spellCheck={false}
            title={PRICING_FIELD_TITLES[f]}
            className="h-9 w-14 px-1.5 text-xs tabular-nums border rounded-md bg-background focus:outline-none focus:ring-1 focus:ring-ring"
            placeholder={catalogPricing !== undefined ? String(catalogPricing[f]) : '—'}
            value={draft[f]}
            onChange={(e) => setDraft({ ...draft, [f]: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                commit();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                cancelled.current = true;
                setEditing(false);
              }
            }}
          />
        ))}
      </div>
    );
  }

  return (
    <button
      type="button"
      title="点击编辑价格（元/百万 tokens：输入/输出/缓存命中），留空回落目录默认价"
      className={
        'shrink-0 text-xs tabular-nums px-2 py-1 rounded border transition-colors ' +
        (entry.pricing !== undefined
          ? 'text-blue-700 dark:text-blue-300 border-blue-300 dark:border-blue-700 hover:bg-blue-50 dark:hover:bg-blue-950'
          : 'text-muted-foreground hover:bg-muted/50')
      }
      onClick={() => {
        setDraft({
          input: entry.pricing !== undefined ? String(entry.pricing.input) : '',
          output: entry.pricing !== undefined ? String(entry.pricing.output) : '',
          cacheRead: entry.pricing !== undefined ? String(entry.pricing.cacheRead) : '',
        });
        cancelled.current = false;
        setEditing(true);
      }}
    >
      {entry.pricing !== undefined
        ? `¥${entry.pricing.input}/${entry.pricing.output}/${entry.pricing.cacheRead} · 手动`
        : catalogPricing !== undefined
          ? `¥${catalogPricing.input}/${catalogPricing.output}/${catalogPricing.cacheRead}`
          : '¥ —'}
    </button>
  );
}
