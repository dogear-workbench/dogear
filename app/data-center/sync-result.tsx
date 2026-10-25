import { useMemo, useState, useEffect } from 'react';
import { AlertTriangle, ChevronDown, Copy, FolderOpen, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Button } from '@/components/ui/button';
import { client } from '@/lib/client';
import { useSyncStore } from '@/stores/sync-store';
import { SYNC_ITEM_IDS } from '@/electron/main/services/settings-types';
import { EXTERNAL_ANCHOR_PREFIX } from '@/electron/main/services/data-items';
import { formatDateTimeShort, formatDuration } from './history-utils';
import { copyRelPath } from './sync-utils';

const REPORT_BADGE: Record<string, { label: string; cls: string }> = {
  completed: { label: '同步完成', cls: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400' },
  failed: { label: '同步失败', cls: 'bg-destructive/10 text-destructive' },
  blocked: { label: '已拦截待确认', cls: 'bg-amber-500/10 text-amber-700 dark:text-amber-400' },
};

/** 冲突分组显示名从数据字典派生（同步项 id → 展示名），未命中原样展示 */
const GROUP_LABELS: Record<string, string> = Object.fromEntries(SYNC_ITEM_IDS.map((m) => [m.id, m.name]));

/** 按顶层目录/文件分组：`workspaces/xxx` → `workspaces`，顶层文件自成一组；工作区外部勾选子树按工作区分组 */
function topGroup(relPath: string): string {
  const segs = relPath.split('/');
  if (segs[0] === EXTERNAL_ANCHOR_PREFIX && segs.length >= 2) return `${EXTERNAL_ANCHOR_PREFIX}/${segs[1]}`;
  const slash = relPath.indexOf('/');
  return slash >= 0 ? relPath.slice(0, slash) : relPath;
}

/** 分组显示名：用户文件勾选子树（__ws-external__/{wsid}）带工作区名，其余查字典派生表 */
function groupLabel(group: string, wsNameById: Map<string, string>): string {
  if (group.startsWith(`${EXTERNAL_ANCHOR_PREFIX}/`)) {
    const wsid = group.slice(EXTERNAL_ANCHOR_PREFIX.length + 1);
    const name = wsNameById.get(wsid);
    return name ? `工作区文件·${name}` : `工作区文件·${wsid.slice(0, 8)}`;
  }
  return GROUP_LABELS[group] ?? group;
}

/**
 * 本端同步范围排除导致的跳过 reason（固定文案：拉取侧 manifest.ts / 应用侧 apply.ts），
 * 只汇总计数不逐条列——排除命中可能是整棵目录树（如 shadow-git），逐条展示纯噪音。
 * 文案改动需与两处源头同步。
 */
const SCOPE_SKIP_REASONS = new Set(['excluded by local sync scope', '本端同步范围已排除，丢弃对端推送']);

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
  const deleteConflicts = lastReport.deleteConflicts ?? [];
  const hasPendingConflicts = lastReport.status === 'completed' && lastReport.conflicts.length > 0;
  const scopeSkipped = lastReport.skipped.filter((s) => SCOPE_SKIP_REASONS.has(s.reason));
  const listedSkipped =
    scopeSkipped.length > 0 ? lastReport.skipped.filter((s) => !SCOPE_SKIP_REASONS.has(s.reason)) : lastReport.skipped;

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
          {(lastReport.deleted ?? 0) > 0 && (
            <span>
              删除 <span className="font-semibold">{lastReport.deleted}</span>
            </span>
          )}
          <span className={hasPendingConflicts ? 'text-amber-600 dark:text-amber-400 font-medium' : ''}>
            待处理冲突 <span className="font-semibold">{lastReport.conflicts.length}</span>
          </span>
          {autoResolved.length > 0 && (
            <span>
              自动裁决 <span className="font-semibold">{autoResolved.length}</span>
            </span>
          )}
          <span>跳过 <span className="font-semibold">{lastReport.skipped.length}</span></span>
          {scopeSkipped.length > 0 && (
            <span className="text-muted-foreground">
              已按范围设置跳过 <span className="font-semibold">{scopeSkipped.length}</span>
            </span>
          )}
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

        {deleteConflicts.length > 0 && (
          <FileListCollapsible
            title={`删改冲突（${deleteConflicts.length}）`}
            hint="删除与修改同时发生，系统保守保留了现存的那个版本，未执行删除；确认要删可手动删除保留侧文件，下轮同步自动收敛"
            items={deleteConflicts.map(({ relPath, kind }) => ({
              key: relPath,
              text: relPath,
              sub:
                kind === 'local-deleted'
                  ? '本端已删除、对端修改过，已保留对端版本'
                  : '对端已删除、本端修改过，已保留本端版本',
            }))}
            onReveal={revealSyncFile}
          />
        )}

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
        {listedSkipped.length > 0 && (
          <FileListCollapsible
            title={`跳过文件（${listedSkipped.length}）`}
            hint="本轮未传输；待处理冲突在选择后重新同步即执行，其余下次同步自动补齐"
            items={listedSkipped.map((s) => ({
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
  const [wsNameById, setWsNameById] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    let alive = true;
    client
      .getAll({})
      .then((r) => {
        if (alive) setWsNameById(new Map((r.workspaces ?? []).map((w) => [w.id, w.name] as const)));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

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
        <AlertTriangle className="w-4 h-4 mt-1 text-amber-600 dark:text-amber-400 shrink-0" />
        <div className="min-w-0 space-y-1">
          <p className="text-sm font-semibold text-amber-700 dark:text-amber-400">
            {conflicts.length} 个冲突待处理，本轮已跳过、两端数据都未被改动
          </p>
          <p className="text-xs leading-5 text-muted-foreground">
            这些文件两端都改过，系统不再自动取新者。选择保留哪一侧后点「应用选择并重新同步」生效；
            被覆盖的一侧会先存为同目录 <code className="font-mono">.conflict-设备短ID</code> 副本，选错可从副本手动换回。
            首次交接建议把旧设备数据拉过来后直接「全部取对端」。
          </p>
        </div>
      </div>

      {/* 批量操作条吸顶：冲突列表长时滚动中始终可及 */}
      <div className="sticky top-0 z-10 -mx-1 px-1 py-1.5 bg-amber-500/5 backdrop-blur-sm flex items-center gap-2 flex-wrap border-b border-amber-500/30">
        <span className="text-xs text-muted-foreground shrink-0">全部：</span>
        <Button size="sm" variant="outline" className="h-8" onClick={() => setMany(conflicts, 'remote')}>
          全部取对端
        </Button>
        <Button size="sm" variant="outline" className="h-8" onClick={() => setMany(conflicts, 'local')}>
          全部保留本端
        </Button>
        {chosenCount > 0 && (
          <Button
            size="sm"
            className="h-8"
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
            <div className="flex items-center justify-between gap-2 px-2.5 py-2 border-b bg-muted/30 flex-wrap">
              <span className="text-sm font-medium leading-6">
                {groupLabel(group, wsNameById)}（{paths.length}）
              </span>
              <div className="flex items-center gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 px-2.5 text-xs"
                  onClick={() => setMany(paths, 'remote')}
                >
                  整组取对端
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 px-2.5 text-xs"
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
                  <li key={relPath} className="px-2.5 py-2 flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-xs leading-5 break-all min-w-0 flex-1 py-0.5">{relPath}</span>
                    <div className="flex items-center gap-1 shrink-0">
                      <Button
                        size="sm"
                        variant={choice === 'remote' ? 'secondary' : 'ghost'}
                        className="h-8 px-2.5 text-xs"
                        onClick={() => setChoices((prev) => ({ ...prev, [relPath]: 'remote' }))}
                      >
                        取对端
                      </Button>
                      <Button
                        size="sm"
                        variant={choice === 'local' ? 'secondary' : 'ghost'}
                        className="h-8 px-2.5 text-xs"
                        onClick={() => setChoices((prev) => ({ ...prev, [relPath]: 'local' }))}
                      >
                        保留本端
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8 w-8 p-0"
                        title="打开所在文件夹（.conflict- 副本在同目录）"
                        onClick={() => revealSyncFile(relPath)}
                      >
                        <FolderOpen className="w-3.5 h-3.5" />
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
                    className="h-8 w-8 p-0"
                    title="打开所在文件夹"
                    onClick={() => onReveal(item.text)}
                  >
                    <FolderOpen className="w-3.5 h-3.5" />
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 w-8 p-0"
                  title="复制路径"
                  onClick={() => copyRelPath(item.text)}
                >
                  <Copy className="w-3.5 h-3.5" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </CollapsibleContent>
    </Collapsible>
  );
}
