import { memo, useEffect, useMemo, useRef } from 'react';
import Ansi from 'ansi-to-react';
import { ChevronRight, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { TerminalEntry } from '@/electron/main/services/terminal-stream-service';

const COLLAPSED_CHARS = 3000;
const EXPANDED_MAX_H = 'max-h-72';

export function formatCommandTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  return new Date(ts).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
}

interface StatusBadgeProps {
  running: boolean;
  exitCode: number | undefined;
}

function StatusBadge({ running, exitCode }: StatusBadgeProps) {
  if (running) {
    return (
      <span className="inline-flex items-center gap-1 shrink-0 text-amber-500">
        <Loader2 className="w-3 h-3 animate-spin" />
        <span>运行中</span>
      </span>
    );
  }
  if (exitCode === 0) {
    return (
      <span className="shrink-0 rounded-sm bg-emerald-500/15 px-1.5 py-px text-emerald-600 dark:text-emerald-400">
        0
      </span>
    );
  }
  if (exitCode !== undefined) {
    return (
      <span className="shrink-0 rounded-sm bg-red-500/15 px-1.5 py-px text-red-600 dark:text-red-400">
        exit {exitCode}
      </span>
    );
  }
  return (
    <span className="shrink-0 rounded-sm bg-muted px-1.5 py-px text-muted-foreground">已终止</span>
  );
}

interface TerminalCardProps {
  entry: TerminalEntry;
  running: boolean;
  expanded: boolean;
  /** 父组件相对时间 tick，仅用于打破 memo 刷新相对时间 */
  timeTick?: number;
  onToggle: (toolCallId: string, currentExpanded: boolean) => void;
}

export const TerminalCard = memo(function TerminalCard({
  entry,
  running,
  expanded,
  onToggle,
}: TerminalCardProps) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const displayText = useMemo(
    () => (expanded ? entry.text : entry.text.length > COLLAPSED_CHARS ? entry.text.slice(-COLLAPSED_CHARS) : entry.text),
    [expanded, entry.text],
  );

  useEffect(() => {
    if (running) {
      const el = bodyRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    }
  }, [running, entry.text]);

  return (
    <div className="rounded-md border bg-card overflow-hidden">
      <button
        type="button"
        className="flex w-full items-center gap-1.5 px-2 py-1.5 text-left hover:bg-muted/50 transition-colors"
        onClick={() => onToggle(entry.toolCallId, expanded)}
      >
        <ChevronRight
          className={cn('w-3 h-3 shrink-0 text-muted-foreground transition-transform', expanded && 'rotate-90')}
        />
        <span className="font-mono text-xs truncate flex-1" title={entry.command}>
          <span className="text-muted-foreground select-none">$ </span>
          {entry.command}
        </span>
        <StatusBadge running={running} exitCode={entry.exitCode} />
        <span
          className="shrink-0 text-[10px] text-muted-foreground tabular-nums"
          title={new Date(entry.startedAt).toLocaleString('zh-CN')}
        >
          {formatCommandTime(entry.startedAt)}
        </span>
      </button>
      {displayText.length > 0 && (
        <div
          ref={bodyRef}
          className={cn(
            'relative border-t bg-muted/30 px-2.5 py-1.5 font-mono text-xs leading-relaxed overflow-y-auto',
            expanded ? EXPANDED_MAX_H : 'max-h-14 overflow-hidden',
          )}
        >
          <Ansi>{displayText}</Ansi>
          {!expanded && displayText.length > 0 && (
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-6 bg-gradient-to-t from-card to-transparent" />
          )}
        </div>
      )}
    </div>
  );
});
