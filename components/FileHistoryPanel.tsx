import { useCallback, useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { History, Loader2, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { client } from '@/lib/client';
import { showConfirm } from '@/stores/confirm-store';
import { useGitHistoryStore } from '@/stores/git-history-store';
import { useWorkspaceStore } from '@/stores/workspace-store';
import type { FileHistoryEntry } from '@/types/electron-api';
import { buildHunks, diffLines, type DiffRow, type DiffStats } from '@/lib/line-diff';
import { HistoryDiffView } from './file-history/HistoryDiffView';

type DiffState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'folder' }
  | { kind: 'too-large' }
  | { kind: 'error'; message: string }
  | { kind: 'ok'; rows: DiffRow[]; stats: DiffStats };

const SOURCE_BADGES: Record<string, { label: string; className: string }> = {
  'agent-write': { label: 'Agent', className: 'bg-violet-500/15 text-violet-600 dark:text-violet-400' },
  'agent-edit': { label: 'Agent', className: 'bg-violet-500/15 text-violet-600 dark:text-violet-400' },
  'ui-create': { label: '你', className: 'bg-blue-500/15 text-blue-600 dark:text-blue-400' },
  'ui-delete': { label: '你', className: 'bg-blue-500/15 text-blue-600 dark:text-blue-400' },
  'ui-rename': { label: '你', className: 'bg-blue-500/15 text-blue-600 dark:text-blue-400' },
  'pre-restore': { label: '恢复前', className: 'bg-amber-500/15 text-amber-600 dark:text-amber-400' },
};

function describeEntry(e: FileHistoryEntry): { badge: string; badgeClass: string; detail: string; convId?: string } {
  if (e.source === 'repo') {
    return { badge: e.author || '外部', badgeClass: 'bg-muted text-muted-foreground', detail: e.message };
  }
  const m = /^\[snapshot\] (\S+)(?: (\S+))?(?: \(conv:([^)]+)\))?$/.exec(e.message);
  const meta = SOURCE_BADGES[m?.[1] ?? ''];
  return {
    badge: meta?.label ?? '快照',
    badgeClass: meta?.className ?? 'bg-muted text-muted-foreground',
    detail: m?.[2] ?? e.message,
    convId: m?.[3],
  };
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function formatTimeFull(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  });
}

export function FileHistoryPanel() {
  const open = useGitHistoryStore(s => s.open);
  const target = useGitHistoryStore(s => s.target);
  const closeHistory = useGitHistoryStore(s => s.closeHistory);

  const [entries, setEntries] = useState<FileHistoryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [diff, setDiff] = useState<DiffState>({ kind: 'idle' });
  const [restoring, setRestoring] = useState(false);

  const loadHistory = useCallback(async () => {
    const ws = useWorkspaceStore.getState().workspace;
    const t = useGitHistoryStore.getState().target;
    if (!ws || !t) return;
    setLoading(true);
    setError(null);
    try {
      const res = await client.getFileHistory({ workspaceId: ws.id, relPath: t.path });
      if ('error' in res) {
        setError(res.error ?? '加载历史失败');
        setEntries([]);
        return;
      }
      setEntries(res.history);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    setSelectedIndex(null);
    setDiff({ kind: 'idle' });
    void loadHistory();
  }, [open, target, loadHistory]);

  const loadDiff = useCallback(async (index: number, list: FileHistoryEntry[]) => {
    const ws = useWorkspaceStore.getState().workspace;
    const t = useGitHistoryStore.getState().target;
    if (!ws || !t) return;
    if (t.isFolder) {
      setDiff({ kind: 'folder' });
      return;
    }
    const entry = list[index];
    if (!entry) return;
    const older = list[index + 1] ?? null;
    setDiff({ kind: 'loading' });
    try {
      const [newRes, oldRes] = await Promise.all([
        client.getHistoryFileContent({ workspaceId: ws.id, source: entry.source, ref: entry.hash, relPath: t.path }),
        older
          ? client.getHistoryFileContent({ workspaceId: ws.id, source: older.source, ref: older.hash, relPath: t.path })
          : Promise.resolve({ content: '' as string | null }),
      ]);
      if ('error' in newRes) {
        setDiff({ kind: 'error', message: newRes.error });
        return;
      }
      const newContent = newRes.content ?? '';
      const oldContent = 'error' in oldRes ? '' : (oldRes.content ?? '');
      const result = diffLines(oldContent, newContent);
      if (!result) {
        setDiff({ kind: 'too-large' });
        return;
      }
      setDiff({ kind: 'ok', rows: result.rows, stats: result.stats });
    } catch (err) {
      setDiff({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  }, []);

  const selectEntry = useCallback((index: number, list: FileHistoryEntry[]) => {
    setSelectedIndex(index);
    void loadDiff(index, list);
  }, [loadDiff]);

  const handleRestore = async () => {
    if (selectedIndex === null || restoring) return;
    const ws = useWorkspaceStore.getState().workspace;
    const t = useGitHistoryStore.getState().target;
    const entry = entries[selectedIndex];
    if (!ws || !t || !entry || entry.source !== 'shadow') return;
    const ok = await showConfirm(
      '恢复历史版本',
      `将「${t.name}」恢复到所选版本（${formatTime(entry.time)}）。恢复前会自动创建"恢复前"快照，可随时撤销。`,
    );
    if (!ok) return;
    setRestoring(true);
    try {
      const res = await client.restoreSnapshot({ workspaceId: ws.id, ref: entry.hash, relPath: t.path });
      if ('error' in res) {
        toast.error('恢复失败', { description: res.error });
        return;
      }
      toast.success('已恢复到所选版本');
      setSelectedIndex(null);
      setDiff({ kind: 'idle' });
      await loadHistory();
      useWorkspaceStore.getState().loadWorkspaceFiles();
    } catch (err) {
      toast.error('恢复失败', { description: err instanceof Error ? err.message : String(err) });
    } finally {
      setRestoring(false);
    }
  };

  const selectedEntry = selectedIndex !== null ? entries[selectedIndex] ?? null : null;
  const selectedDetail = selectedEntry ? describeEntry(selectedEntry) : null;
  const canRestore = selectedEntry?.source === 'shadow' && !restoring;
  const hasOlder = selectedIndex !== null && selectedIndex < entries.length - 1;
  const sections = useMemo(() => (diff.kind === 'ok' ? buildHunks(diff.rows) : []), [diff]);

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) closeHistory(); }}>
      <DialogContent
        className="sm:max-w-4xl h-[75vh] flex flex-col gap-0 p-0 overflow-hidden"
        onInteractOutside={(e) => e.preventDefault()}
        onPointerDownOutside={(e) => e.preventDefault()}
      >
        <DialogHeader className="flex-shrink-0 px-6 pt-5 pb-3 border-b">
          <DialogTitle className="flex items-center gap-2 truncate pr-8">
            <History className="w-5 h-5 shrink-0" />
            <span className="truncate">历史记录 · {target?.name ?? ''}</span>
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-1 min-h-0">
          {/* 左侧：时间线 */}
          <div className="w-72 shrink-0 border-r flex flex-col min-h-0">
            <ScrollArea className="flex-1 min-h-0">
              {loading && (
                <div className="flex items-center justify-center py-10 text-sm text-muted-foreground">
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                  加载中...
                </div>
              )}
              {!loading && error && (
                <div className="px-3 py-4 text-sm text-red-600">{error}</div>
              )}
              {!loading && !error && entries.length === 0 && (
                <div className="px-3 py-10 text-center text-sm text-muted-foreground">
                  暂无历史记录
                </div>
              )}
              {!loading && !error && entries.map((e, idx) => {
                const d = describeEntry(e);
                return (
                  <button
                    key={`${e.source}-${e.hash}-${idx}`}
                    className={cn(
                      'w-full text-left px-3 py-2 border-b border-border/50 hover:bg-muted/50 transition-colors',
                      selectedIndex === idx && 'bg-primary/10',
                    )}
                    onClick={() => selectEntry(idx, entries)}
                  >
                    <div className="flex items-center gap-1.5">
                      <span className={cn('inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium shrink-0', d.badgeClass)}>
                        {d.badge}
                      </span>
                      <span className="text-xs text-muted-foreground ml-auto shrink-0">{formatTime(e.time)}</span>
                    </div>
                    <div className="text-xs mt-1 truncate" title={e.message}>{d.detail || e.message}</div>
                    <div className="text-[10px] text-muted-foreground/70 font-mono mt-0.5">
                      {e.source === 'shadow' ? '快照' : '仓库'} · {e.hash.slice(0, 7)}
                    </div>
                  </button>
                );
              })}
            </ScrollArea>
          </div>

          {/* 右侧：版本详情头 + diff */}
          <div className="flex-1 min-w-0 flex flex-col">
            {selectedEntry && selectedDetail ? (
              <div className="flex items-start justify-between gap-3 px-4 py-2.5 border-b shrink-0">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={cn('inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium shrink-0', selectedDetail.badgeClass)}>
                      {selectedDetail.badge}
                    </span>
                    <span className="text-xs text-muted-foreground shrink-0">{formatTimeFull(selectedEntry.time)}</span>
                    <span className="text-[10px] text-muted-foreground/70 font-mono shrink-0">
                      {selectedEntry.source === 'shadow' ? '快照' : '仓库'} · {selectedEntry.hash.slice(0, 7)}
                    </span>
                    {diff.kind === 'ok' && (
                      <span className="ml-auto shrink-0 font-mono text-xs">
                        {!hasOlder && <span className="mr-1.5 font-sans text-muted-foreground">全新增</span>}
                        <span className="text-green-600 dark:text-green-400">+{diff.stats.added}</span>
                        <span className="mx-0.5 text-muted-foreground">/</span>
                        <span className="text-red-600 dark:text-red-400">-{diff.stats.removed}</span>
                      </span>
                    )}
                  </div>
                  {(selectedDetail.detail || selectedEntry.message) && (
                    <div className="text-xs mt-1 whitespace-pre-wrap break-words">
                      {selectedDetail.detail || selectedEntry.message}
                    </div>
                  )}
                  {selectedDetail.convId && (
                    <div
                      className="text-[10px] text-muted-foreground/60 font-mono mt-0.5 truncate"
                      title={selectedDetail.convId}
                    >
                      会话 {selectedDetail.convId.slice(0, 8)}
                    </div>
                  )}
                </div>
                {selectedEntry.source === 'shadow' && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 shrink-0 gap-1.5 text-xs"
                    disabled={!canRestore}
                    onClick={() => void handleRestore()}
                  >
                    {restoring ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
                    恢复此版本
                  </Button>
                )}
              </div>
            ) : (
              <div className="px-4 py-2.5 border-b shrink-0 text-xs text-muted-foreground">
                在左侧选择一个版本查看差异
              </div>
            )}
            <ScrollArea className="flex-1 min-h-0">
              <div className="px-4 py-3">
                {diff.kind === 'loading' && (
                  <div className="flex items-center justify-center py-10 text-sm text-muted-foreground">
                    <Loader2 className="w-4 h-4 animate-spin mr-2" />
                    加载差异...
                  </div>
                )}
                {diff.kind === 'folder' && (
                  <div className="py-10 text-center text-sm text-muted-foreground">
                    文件夹不支持内容对比，可在左侧选择版本后整体恢复
                  </div>
                )}
                {diff.kind === 'too-large' && (
                  <div className="py-10 text-center text-sm text-muted-foreground">文件过大，暂不支持对比</div>
                )}
                {diff.kind === 'error' && (
                  <div className="py-10 text-center text-sm text-red-600">对比失败：{diff.message}</div>
                )}
                {diff.kind === 'ok' && <HistoryDiffView key={selectedIndex ?? 'none'} sections={sections} />}
              </div>
            </ScrollArea>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
