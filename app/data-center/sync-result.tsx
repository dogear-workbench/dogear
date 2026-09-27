import { AlertTriangle, ChevronDown, Copy, RefreshCw } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Button } from '@/components/ui/button';
import { useSyncStore } from '@/stores/sync-store';
import { formatDateTimeShort, formatDuration } from './history-utils';
import { copyRelPath } from './sync-utils';

const REPORT_BADGE: Record<string, { label: string; cls: string }> = {
  completed: { label: '同步完成', cls: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400' },
  failed: { label: '同步失败', cls: 'bg-destructive/10 text-destructive' },
  blocked: { label: '已拦截待确认', cls: 'bg-amber-500/10 text-amber-700 dark:text-amber-400' },
};

export function SyncResultCard() {
  const lastReport = useSyncStore((s) => s.lastReport);
  const runningSync = useSyncStore((s) => s.runningSync);
  if (runningSync) {
    return (
      <Card>
        <CardContent className="py-4 flex items-center gap-2 text-sm text-muted-foreground">
          <RefreshCw className="w-3.5 h-3.5 animate-spin" />
          同步进行中，完成后此处展示拉取/推送/冲突结果…
        </CardContent>
      </Card>
    );
  }
  if (!lastReport) {
    return <p className="text-xs text-muted-foreground">还没有同步记录。在上方在线设备卡片点「同步」开始。</p>;
  }

  const badge = REPORT_BADGE[lastReport.status];
  const peerLabel = lastReport.peerName ?? lastReport.peerId;

  return (
    <Card>
      <CardContent className="py-4 space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          {badge ? (
            <Badge variant="subtle" className={badge.cls}>
              {badge.label}
            </Badge>
          ) : (
            <Badge variant="subtle">{lastReport.status}</Badge>
          )}
          <span className="text-sm font-medium">与 {peerLabel} 的上次同步</span>
          <span className="text-xs text-muted-foreground">
            {formatDateTimeShort(lastReport.finishedAt)} · 耗时 {formatDuration(lastReport.durationMs)}
          </span>
        </div>

        <div className="text-sm flex items-center gap-3 flex-wrap">
          <span>拉取 <span className="font-semibold">{lastReport.pulled}</span></span>
          <span>推送 <span className="font-semibold">{lastReport.pushed}</span></span>
          <span className={lastReport.conflicts.length > 0 ? 'text-amber-600 dark:text-amber-400' : ''}>
            冲突 <span className="font-semibold">{lastReport.conflicts.length}</span>
          </span>
          <span>跳过 <span className="font-semibold">{lastReport.skipped.length}</span></span>
        </div>

        {lastReport.error && (
          <p className="text-xs text-destructive">{lastReport.error}</p>
        )}
        {lastReport.warnings.map((w) => (
          <p key={w} className="text-xs text-amber-600 dark:text-amber-400 flex items-start gap-1">
            <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
            {w}
          </p>
        ))}

        {lastReport.conflicts.length > 0 && (
          <FileListCollapsible
            title={`冲突文件（${lastReport.conflicts.length}）`}
            hint="双方都改过的文件按修改时间保留较新一侧，另一侧保留为 .conflict- 副本；首次同步冲突较多属预期"
            items={lastReport.conflicts.map((relPath) => ({ key: relPath, text: relPath }))}
          />
        )}
        {lastReport.skipped.length > 0 && (
          <FileListCollapsible
            title={`跳过文件（${lastReport.skipped.length}）`}
            hint="本轮未传输，下次同步自动补齐"
            items={lastReport.skipped.map((s) => ({
              key: `${s.relPath}:${s.reason}`,
              text: s.relPath,
              sub: s.reason,
            }))}
          />
        )}
      </CardContent>
    </Card>
  );
}

function FileListCollapsible({
  title,
  hint,
  items,
}: {
  title: string;
  hint: string;
  items: Array<{ key: string; text: string; sub?: string }>;
}) {
  return (
    <Collapsible>
      <CollapsibleTrigger className="group flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
        <span className="underline underline-offset-2">{title}</span>
        <ChevronDown className="w-3 h-3 transition-transform group-data-[state=open]:rotate-180" />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <p className="mt-1.5 text-[11px] text-muted-foreground/80">{hint}</p>
        <ul className="mt-1 space-y-1">
          {items.map((item) => (
            <li key={item.key} className="flex items-start justify-between gap-2 rounded bg-muted/40 px-2 py-1">
              <div className="min-w-0">
                <span className="block font-mono text-[11px] break-all">{item.text}</span>
                {item.sub && <span className="block text-[11px] text-muted-foreground">{item.sub}</span>}
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="h-5 w-5 p-0 shrink-0"
                title="复制路径"
                onClick={() => copyRelPath(item.text)}
              >
                <Copy className="w-3 h-3" />
              </Button>
            </li>
          ))}
        </ul>
      </CollapsibleContent>
    </Collapsible>
  );
}
