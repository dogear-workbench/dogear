import { useState } from 'react';
import { Archive, ChevronDown, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { client } from '@/lib/client';
import { showConfirm } from '@/stores/confirm-store';
import type { BackupCategoryKey, BackupCategorySetting } from '@/types/settings';
import {
  CATEGORY_META,
  FREQUENCY_LABELS,
  FREQUENCY_OPTIONS,
  formatBytes,
  formatListTime,
  formatTime,
  type BackupEntry,
  type BackupScopeStatus,
} from './backup-meta';

interface ListState {
  loading: boolean;
  backups: BackupEntry[];
}

interface Props {
  category: BackupCategoryKey;
  rows: BackupScopeStatus[];
  nameById: Map<string, string>;
  config: BackupCategorySetting;
  runningKeys: Set<string>;
  onConfigChange: (key: BackupCategoryKey, patch: Partial<BackupCategorySetting>) => void;
  onRun: (key: BackupCategoryKey, scope: string) => void;
  onChanged: () => void;
}

export function CategoryCard({ category, rows, nameById, config, runningKeys, onConfigChange, onRun, onChanged }: Props) {
  const meta = CATEGORY_META[category];
  const [openScopes, setOpenScopes] = useState<Set<string>>(new Set());
  const [lists, setLists] = useState<Record<string, ListState>>({});
  const [restoring, setRestoring] = useState<string | null>(null);
  const [keepDraft, setKeepDraft] = useState<string | null>(null);

  const scopeLabel = (scope: string) => (scope === 'global' ? '全局' : nameById.get(scope) ?? scope);

  const commitKeep = () => {
    if (keepDraft == null) return;
    const n = Math.max(1, Math.floor(Number(keepDraft) || 1));
    setKeepDraft(null);
    if (n !== config.keep) onConfigChange(category, { keep: n });
  };

  const loadList = async (scope: string) => {
    setLists((prev) => ({ ...prev, [scope]: { loading: true, backups: prev[scope]?.backups ?? [] } }));
    try {
      const r = await client.listBackups({ category, scope });
      const backups = 'error' in r ? [] : r.backups;
      setLists((prev) => ({ ...prev, [scope]: { loading: false, backups } }));
    } catch (e) {
      toast.error('加载备份列表失败', { description: String(e) });
      setLists((prev) => ({ ...prev, [scope]: { loading: false, backups: [] } }));
    }
  };

  const toggleScope = (scope: string) => {
    setOpenScopes((prev) => {
      const next = new Set(prev);
      if (next.has(scope)) {
        next.delete(scope);
      } else {
        next.add(scope);
      }
      return next;
    });
    loadList(scope);
  };

  const handleRestore = async (scope: string, entry: BackupEntry) => {
    const ok = await showConfirm(
      '恢复备份',
      `将「${meta.name}」（${scopeLabel(scope)}）恢复到 ${formatTime(entry.time)} 的备份。\n\n恢复前会自动备份当前状态。确定继续？`,
    );
    if (!ok) return;
    setRestoring(entry.fileName);
    try {
      const r = await client.restoreBackup({ category, scope, fileName: entry.fileName });
      if ('error' in r) {
        toast.error('恢复失败', { description: r.error });
        return;
      }
      toast.success('恢复完成', { description: `恢复前状态已备份为 ${r.preBackupFileName}` });
      await loadList(scope);
      onChanged();
    } catch (e) {
      toast.error('恢复失败', { description: String(e) });
    } finally {
      setRestoring(null);
    }
  };

  return (
    <Card className="py-4 gap-3 px-4">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-medium">{meta.name}</div>
          <div className="text-xs text-muted-foreground mt-0.5">{meta.scopeSummary}</div>
        </div>
        <Switch
          checked={config.enabled}
          onCheckedChange={(v) => onConfigChange(category, { enabled: v })}
          aria-label={`启用${meta.name}备份`}
        />
      </div>

      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span>自动频率</span>
        <Select
          value={config.frequency}
          onValueChange={(v) => onConfigChange(category, { frequency: v as BackupCategorySetting['frequency'] })}
        >
          <SelectTrigger size="sm" className="w-[92px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {FREQUENCY_OPTIONS.map((f) => (
              <SelectItem key={f} value={f}>
                {FREQUENCY_LABELS[f]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="ml-2">保留</span>
        <Input
          type="number"
          min={1}
          className="h-7 w-16 px-2 text-xs"
          value={keepDraft ?? String(config.keep)}
          onChange={(e) => setKeepDraft(e.target.value)}
          onBlur={commitKeep}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          }}
        />
        <span>份</span>
      </div>

      <div>
        {rows.length === 0 ? (
          <div className="text-xs text-muted-foreground py-2">暂无适用的备份范围</div>
        ) : (
          rows.map((row) => {
            const runKey = `${row.scope}:${row.key}`;
            const running = runningKeys.has(runKey);
            const isOpen = openScopes.has(row.scope);
            const list = lists[row.scope];
            return (
              <div key={row.scope} className="border-t first:border-t-0">
                <div className="flex items-center gap-2 py-2 min-w-0">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 text-sm">
                      <span className="truncate" title={scopeLabel(row.scope)}>
                        {scopeLabel(row.scope)}
                      </span>
                      {row.due && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-600 shrink-0">
                          已到期
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {row.count} 份 · 最近 {formatTime(row.lastBackupAt)}
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs shrink-0"
                    disabled={!row.enabled || running}
                    title={row.enabled ? undefined : '分类已禁用，请先打开开关'}
                    onClick={() => onRun(category, row.scope)}
                  >
                    {running && <Loader2 className="w-3 h-3 mr-1 animate-spin" />}
                    {running ? '备份中…' : '立即备份'}
                  </Button>
                  <button
                    className="p-1 rounded hover:bg-accent shrink-0"
                    aria-label="展开备份列表"
                    onClick={() => toggleScope(row.scope)}
                  >
                    <ChevronDown className={cn('w-4 h-4 text-muted-foreground transition-transform', isOpen && 'rotate-180')} />
                  </button>
                </div>
                {isOpen && (
                  <div className="pb-3 pt-1">
                    {list?.loading ? (
                      <div className="flex items-center gap-2 text-xs text-muted-foreground py-1">
                        <Loader2 className="w-3 h-3 animate-spin" />
                        加载中…
                      </div>
                    ) : !list || list.backups.length === 0 ? (
                      <div className="text-xs text-muted-foreground py-1">暂无备份文件</div>
                    ) : (
                      <div className="space-y-1">
                        {list.backups.map((b) => (
                          <div key={b.fileName} className="flex items-center gap-2 text-xs min-w-0">
                            <Archive className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
                            <span className="font-mono truncate flex-1" title={b.fileName}>
                              {b.fileName}
                            </span>
                            <span className="text-muted-foreground shrink-0">{formatListTime(b.time)}</span>
                            <span className="text-muted-foreground shrink-0 w-14 text-right">{formatBytes(b.size)}</span>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 px-2 text-xs shrink-0"
                              disabled={restoring != null}
                              onClick={() => handleRestore(row.scope, b)}
                            >
                              {restoring === b.fileName && <Loader2 className="w-3 h-3 mr-1 animate-spin" />}
                              恢复
                            </Button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </Card>
  );
}
