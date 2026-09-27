import { useMemo, useState } from 'react';
import { AlertTriangle, ChevronDown, Copy, FolderOpen, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Button } from '@/components/ui/button';
import { client } from '@/lib/client';
import { useSyncStore } from '@/stores/sync-store';
import { formatDateTimeShort, formatDuration } from './history-utils';
import { copyRelPath } from './sync-utils';

const REPORT_BADGE: Record<string, { label: string; cls: string }> = {
  completed: { label: '同步完成', cls: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400' },
  failed: { label: '同步失败', cls: 'bg-destructive/10 text-destructive' },
  blocked: { label: '已拦截待确认', cls: 'bg-amber-500/10 text-amber-700 dark:text-amber-400' },
};

/** 冲突分组显示名（顶层目录 → 中文），未命中原样展示 */
const GROUP_LABELS: Record<string, string> = {
  workspaces: '工作区数据',
  conversations: '会话记录',
  memory: '记忆',
  usage: '用量数据',
  'article-parser': '文章解析',
  'site-knowledge': '站点知识',
  'run-history': '运行历史',
};

/** 按顶层目录/文件分组：`workspaces/xxx` → `workspaces`，顶层文件自成一组 */
function topGroup(relPath: string): string {
  const slash = relPath.indexOf('/');
  return slash >= 0 ? relPath.slice(0, slash) : relPath;
}

function revealSyncFile(relPath: string): void {
  void client
    .revealSyncFile({ relPath })
    .then((r) => {
      if (!r.success) toast.error('打开文件夹失败', { description: r.error });
    })
    .catch((err) => toast.error('打开文件夹失败', { description: String(err) }));
}

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
  const directionLabel =
    lastReport.direction === 'push' ? '仅推送' : lastReport.direction === 'both' ? '双向' : '仅拉取';
  const autoResolved = lastReport.autoResolved ?? [];
  const hasPendingConflicts = lastReport.status === 'completed' && lastReport.conflicts.length > 0;

  return (
    <Card className={hasPendingConflicts ? 'border-amber-500/60' : undefined}>
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
          <Badge variant="subtle" className="shrink-0">{directionLabel}</Badge>
          <span className="text-xs text-muted-foreground">
            {formatDateTimeShort(lastReport.finishedAt)} · 耗时 {formatDuration(lastReport.durationMs)}
          </span>
        </div>

        <div className="text-sm flex items-center gap-3 flex-wrap">
          <span>拉取 <span className="font-semibold">{lastReport.pulled}</span></span>
          <span>推送 <span className="font-semibold">{lastReport.pushed}</span></span>
          <span className={hasPendingConflicts ? 'text-amber-600 dark:text-amber-400 font-medium' : ''}>
            待处理冲突 <span className="font-semibold">{lastReport.conflicts.length}</span>
          </span>
          {autoResolved.length > 0 && (
            <span>
              自动裁决 <span className="font-semibold">{autoResolved.length}</span>
            </span>
          )}
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

        {hasPendingConflicts && (
          <ConflictPendingZone conflicts={lastReport.conflicts} peerId={lastReport.peerId} />
        )}

        {autoResolved.length > 0 && (
          <FileListCollapsible
            title={`自动裁决冲突（${autoResolved.length}）`}
            hint="仅拉取档按修改时间自动取新者：覆盖前败方已存为同目录 .conflict-设备短ID 副本，选错可打开文件夹手动换回"
            items={autoResolved.map(({ relPath, winner }) => ({
              key: relPath,
              text: relPath,
              sub:
                winner === 'remote'
                  ? '已拉取对端较新版本，本机旧版留副本'
                  : '保留本机较新版本，对端未被修改',
            }))}
            onReveal={revealSyncFile}
          />
        )}
        {lastReport.skipped.length > 0 && (
          <FileListCollapsible
            title={`跳过文件（${lastReport.skipped.length}）`}
            hint="本轮未传输；待处理冲突在选择后重新同步即执行，其余下次同步自动补齐"
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

/**
 * 待处理冲突显著区：顶部横幅 + 按顶层目录分组列表（默认展开）。
 * 选择粒度：全局一键 / 整组批量 / 单行；选择后「应用选择并重新同步」以双向档带裁决表重跑。
 */
function ConflictPendingZone({ conflicts, peerId }: { conflicts: string[]; peerId: string }) {
  const runSync = useSyncStore((s) => s.runSync);
  const runningSync = useSyncStore((s) => s.runningSync);
  const [choices, setChoices] = useState<Record<string, 'local' | 'remote'>>({});

  const groups = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const relPath of conflicts) {
      const g = topGroup(relPath);
      const list = map.get(g);
      if (list) list.push(relPath);
      else map.set(g, [relPath]);
    }
    return [...map.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [conflicts]);

  const chosenCount = Object.keys(choices).length;

  const setMany = (paths: string[], value: 'local' | 'remote') => {
    setChoices((prev) => {
      const next = { ...prev };
      for (const p of paths) next[p] = value;
      return next;
    });
  };

  return (
    <div className="rounded-md border border-amber-500/50 bg-amber-500/5 p-3 space-y-3">
      <div className="flex items-start gap-2">
        <AlertTriangle className="w-4 h-4 mt-0.5 text-amber-600 dark:text-amber-400 shrink-0" />
        <div className="min-w-0 space-y-1">
          <p className="text-sm font-medium text-amber-700 dark:text-amber-400">
            {conflicts.length} 个冲突待处理，本轮已跳过、两端数据都未被改动
          </p>
          <p className="text-xs text-muted-foreground">
            这些文件两端都改过，系统不再自动取新者。选择保留哪一侧后点「应用选择并重新同步」生效；
            被覆盖的一侧会先存为同目录 <code className="font-mono">.conflict-设备短ID</code> 副本，选错可从副本手动换回。
            首次交接建议把旧设备数据拉过来后直接「全部取对端」。
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-muted-foreground shrink-0">全部：</span>
        <Button size="sm" variant="outline" className="h-7" onClick={() => setMany(conflicts, 'remote')}>
          全部取对端
        </Button>
        <Button size="sm" variant="outline" className="h-7" onClick={() => setMany(conflicts, 'local')}>
          全部保留本端
        </Button>
        {chosenCount > 0 && (
          <Button
            size="sm"
            className="h-7"
            disabled={runningSync !== null}
            onClick={() => void runSync(peerId, { direction: 'both', conflictResolutions: { ...choices } })}
          >
            {runningSync ? '同步中…' : `应用选择并重新同步（${chosenCount}/${conflicts.length}）`}
          </Button>
        )}
      </div>

      <div className="space-y-2">
        {groups.map(([group, paths]) => (
          <div key={group} className="rounded-md border bg-background/60">
            <div className="flex items-center justify-between gap-2 px-2 py-1.5 border-b bg-muted/30 flex-wrap">
              <span className="text-xs font-medium">
                {GROUP_LABELS[group] ?? group}（{paths.length}）
              </span>
              <div className="flex items-center gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 px-2 text-xs"
                  onClick={() => setMany(paths, 'remote')}
                >
                  整组取对端
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 px-2 text-xs"
                  onClick={() => setMany(paths, 'local')}
                >
                  整组保留本端
                </Button>
              </div>
            </div>
            <ul className="divide-y">
              {paths.map((relPath) => {
                const choice = choices[relPath];
                return (
                  <li key={relPath} className="px-2 py-1.5 flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-[11px] break-all min-w-0 flex-1">{relPath}</span>
                    <div className="flex items-center gap-1 shrink-0">
                      <Button
                        size="sm"
                        variant={choice === 'remote' ? 'secondary' : 'ghost'}
                        className="h-6 px-2 text-xs"
                        onClick={() => setChoices((prev) => ({ ...prev, [relPath]: 'remote' }))}
                      >
                        取对端
                      </Button>
                      <Button
                        size="sm"
                        variant={choice === 'local' ? 'secondary' : 'ghost'}
                        className="h-6 px-2 text-xs"
                        onClick={() => setChoices((prev) => ({ ...prev, [relPath]: 'local' }))}
                      >
                        保留本端
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 w-6 p-0"
                        title="打开所在文件夹（.conflict- 副本在同目录）"
                        onClick={() => revealSyncFile(relPath)}
                      >
                        <FolderOpen className="w-3 h-3" />
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

function FileListCollapsible({
  title,
  hint,
  items,
  onReveal,
}: {
  title: string;
  hint: string;
  items: Array<{ key: string; text: string; sub?: string }>;
  /** 提供时每行显示「打开所在文件夹」按钮（如自动裁决冲突的副本换回） */
  onReveal?: (relPath: string) => void;
}) {
  return (
    <Collapsible defaultOpen={onReveal !== undefined}>
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
              <div className="flex items-center gap-0.5 shrink-0">
                {onReveal && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-5 w-5 p-0"
                    title="打开所在文件夹"
                    onClick={() => onReveal(item.text)}
                  >
                    <FolderOpen className="w-3 h-3" />
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-5 w-5 p-0"
                  title="复制路径"
                  onClick={() => copyRelPath(item.text)}
                >
                  <Copy className="w-3 h-3" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </CollapsibleContent>
    </Collapsible>
  );
}
