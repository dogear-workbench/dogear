import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  FALLBACK_CONTEXT_WINDOW,
  formatContextLabel,
  lookupContextWindow,
  parseContextInput,
} from '@/lib/pi-model-catalog';

export interface PiModelEntry {
  id: string;
  label?: string;
  contextWindow?: number;
}

interface PiModelRowProps {
  entry: PiModelEntry;
  others: PiModelEntry[];
  onChange: (next: PiModelEntry) => void;
  onRemove: () => void;
}

function buildEntry(id: string, label: string | undefined, contextWindow: number | undefined): PiModelEntry {
  const next: PiModelEntry = { id };
  if (label) next.label = label;
  if (contextWindow !== undefined) next.contextWindow = contextWindow;
  return next;
}

export function PiModelRow({ entry, others, onChange, onRemove }: PiModelRowProps) {
  const [idDraft, setIdDraft] = useState(entry.id);
  const [idError, setIdError] = useState(false);
  const [windowDraft, setWindowDraft] = useState('');
  const [windowEditing, setWindowEditing] = useState(false);
  const windowCancelled = useRef(false);

  const catalogWindow = lookupContextWindow(entry.id);

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
    onChange(buildEntry(next, entry.label, entry.contextWindow));
  };

  const startWindowEdit = () => {
    setWindowDraft(entry.contextWindow !== undefined ? String(entry.contextWindow) : '');
    windowCancelled.current = false;
    setWindowEditing(true);
  };

  const commitWindow = () => {
    const raw = windowDraft.trim();
    if (raw === '') {
      if (entry.contextWindow !== undefined) onChange(buildEntry(entry.id, entry.label, undefined));
    } else {
      const parsed = parseContextInput(raw);
      if (parsed !== undefined && parsed !== entry.contextWindow) {
        onChange(buildEntry(entry.id, entry.label, parsed));
      }
    }
    setWindowEditing(false);
  };

  return (
    <div className="flex items-center gap-2">
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
      {windowEditing ? (
        <input
          type="text"
          autoFocus
          spellCheck={false}
          className="h-9 w-28 shrink-0 px-2 text-xs tabular-nums border rounded-md bg-background focus:outline-none focus:ring-1 focus:ring-ring"
          value={windowDraft}
          placeholder="1M / 200K / 262144"
          onChange={(e) => setWindowDraft(e.target.value)}
          onBlur={() => {
            if (!windowCancelled.current) commitWindow();
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commitWindow();
            } else if (e.key === 'Escape') {
              e.preventDefault();
              windowCancelled.current = true;
              setWindowEditing(false);
            }
          }}
        />
      ) : (
        <button
          type="button"
          title="点击手填上下文窗口"
          className={cn(
            'shrink-0 text-xs tabular-nums px-2 py-1 rounded border transition-colors',
            entry.contextWindow !== undefined
              ? 'text-blue-700 dark:text-blue-300 border-blue-300 dark:border-blue-700 hover:bg-blue-50 dark:hover:bg-blue-950'
              : catalogWindow !== undefined
                ? 'text-muted-foreground hover:bg-muted/50'
                : 'text-yellow-700 dark:text-yellow-300 border-yellow-300 dark:border-yellow-700 hover:bg-yellow-50 dark:hover:bg-yellow-950',
          )}
          onClick={startWindowEdit}
        >
          {entry.contextWindow !== undefined
            ? `${formatContextLabel(entry.contextWindow)} · 手动`
            : catalogWindow !== undefined
              ? formatContextLabel(catalogWindow)
              : `${formatContextLabel(FALLBACK_CONTEXT_WINDOW)} · 未识别`}
        </button>
      )}
      <input
        type="text"
        className="h-9 w-44 px-3 text-sm border rounded-md bg-background focus:outline-none focus:ring-1 focus:ring-ring"
        value={entry.label ?? ''}
        placeholder={entry.id}
        onChange={(e) => {
          const v = e.target.value;
          onChange(buildEntry(entry.id, v === '' ? undefined : v, entry.contextWindow));
        }}
      />
      <Button variant="ghost" size="sm" onClick={onRemove}>
        <Trash2 className="w-4 h-4 text-destructive" />
      </Button>
    </div>
  );
}
