import { useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Search, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { showConfirm } from '@/stores/confirm-store';
import { client } from '@/lib/client';
import type { Workspace } from '@/types/electron-api';

interface OrphanWorkspace {
  id: string;
  sourceName?: string;
  sourcePath?: string;
  conversationCount: number;
  sampleTitles: string[];
  lastUpdated: string | null;
}

interface Props {
  workspaces: Workspace[];
}

export function OrphansPanel({ workspaces }: Props) {
  const [scanning, setScanning] = useState(false);
  const [orphans, setOrphans] = useState<OrphanWorkspace[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [targets, setTargets] = useState<Record<string, string>>({});

  const defaultTargetId = workspaces.find((w) => w.isDefault)?.id ?? workspaces[0]?.id ?? '';
  const targetOf = (orphan: OrphanWorkspace) => targets[orphan.id] ?? defaultTargetId;

  const handleScan = async () => {
    setScanning(true);
    try {
      const result = (await client.scanOrphanWorkspaces()) as OrphanWorkspace[];
      setOrphans(result);
    } catch (err) {
      console.error('扫描丢失会话失败:', err);
      toast.error('扫描失败', {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setScanning(false);
    }
  };

  const handleImport = async (orphan: OrphanWorkspace) => {
    const targetWorkspaceId = targetOf(orphan);
    const target = workspaces.find((w) => w.id === targetWorkspaceId);
    if (!targetWorkspaceId || !target) {
      toast.warning('请先选择要并入的工作区');
      return;
    }
    setBusyId(orphan.id);
    try {
      // 不传 deleteAfterImport：导入只合并会话索引，源目录保留
      const result = (await client.importOrphanWorkspace({
        orphanId: orphan.id,
        targetWorkspaceId,
      })) as { importedCount: number };
      toast.success(`已合并 ${result.importedCount} 条会话到「${target.name}」`, {
        description: '源目录已保留，确认无遗漏后可用「舍弃」清理',
      });
      setOrphans((prev) => prev?.filter((o) => o.id !== orphan.id) ?? null);
    } catch (err) {
      console.error('导入失败:', err);
      toast.error('导入失败', {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusyId(null);
    }
  };

  const handleDiscard = async (orphan: OrphanWorkspace) => {
    const name = orphan.sourceName || `未知来源 (${orphan.id.slice(0, 8)}...)`;
    const ok = await showConfirm(
      '舍弃丢失的会话',
      `将删除「${name}」源目录中的全部数据（含会话正文），此操作不可恢复。确定舍弃吗？`,
    );
    if (!ok) return;
    setBusyId(orphan.id);
    try {
      const result = (await client.discardOrphanWorkspace({ orphanId: orphan.id })) as {
        success: boolean;
        error?: string;
      };
      if (result.success) {
        toast.success(`已舍弃「${name}」`);
        setOrphans((prev) => prev?.filter((o) => o.id !== orphan.id) ?? null);
      } else {
        toast.error('舍弃失败', { description: result.error });
      }
    } catch (err) {
      console.error('舍弃失败:', err);
      toast.error('舍弃失败', {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div>
      <div className="flex items-center gap-3 flex-wrap mb-4">
        <h2 className="text-lg font-semibold">丢失的会话</h2>
        <Button variant="outline" size="sm" onClick={() => void handleScan()} disabled={scanning}>
          {scanning ? (
            <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
          ) : (
            <Search className="w-3.5 h-3.5 mr-1.5" />
          )}
          扫描
        </Button>
        {orphans && (
          <span className="text-xs text-muted-foreground">
            {orphans.length > 0
              ? `找到 ${orphans.length} 组未关联工作区的会话`
              : '没有找到丢失的会话数据'}
          </span>
        )}
      </div>

      {!orphans ? (
        <p className="text-sm text-muted-foreground">
          扫描应用数据目录里未关联工作区的历史会话，把找回的会话并入任意工作区。
        </p>
      ) : orphans.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          一切正常。丢失的会话通常来自备份恢复或手动改动数据目录，出现后再来扫描即可。
        </p>
      ) : (
        <>
          <div className="space-y-2">
            {orphans.map((orphan) => {
              const busy = busyId === orphan.id;
              return (
                <div
                  key={orphan.id}
                  className="flex items-center gap-3 border rounded-md px-3 py-2.5"
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">
                      {orphan.sourceName || `未知来源 (${orphan.id.slice(0, 8)}...)`}
                      <span className="text-muted-foreground font-normal">
                        {' '}· {orphan.conversationCount} 个对话
                      </span>
                    </div>
                    <div className="text-xs text-muted-foreground truncate mt-0.5">
                      {orphan.lastUpdated && `最后更新 ${new Date(orphan.lastUpdated).toLocaleDateString()}`}
                      {orphan.sampleTitles.length > 0 && ` · ${orphan.sampleTitles.join('、')}${orphan.conversationCount > 5 ? '…' : ''}`}
                    </div>
                  </div>
                  <Select
                    value={targetOf(orphan) || undefined}
                    onValueChange={(v) => setTargets((prev) => ({ ...prev, [orphan.id]: v }))}
                    disabled={workspaces.length === 0 || busy}
                  >
                    <SelectTrigger size="sm" className="w-[150px] shrink-0" aria-label="选择并入的工作区">
                      <SelectValue placeholder={workspaces.length === 0 ? '无可用工作区' : '并入哪个工作区'} />
                    </SelectTrigger>
                    <SelectContent>
                      {workspaces.map((w) => (
                        <SelectItem key={w.id} value={w.id}>
                          并入：{w.name}
                          {w.isDefault ? '（默认）' : ''}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    variant="outline"
                    size="sm"
                    className="shrink-0"
                    onClick={() => void handleImport(orphan)}
                    disabled={busy || workspaces.length === 0}
                  >
                    {busy && <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />}
                    导入
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:text-destructive shrink-0"
                    onClick={() => void handleDiscard(orphan)}
                    disabled={busy}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    舍弃
                  </Button>
                </div>
              );
            })}
          </div>
          <p className="text-xs text-muted-foreground mt-2.5">
            导入只合并会话索引到所选工作区，源目录保留；「舍弃」会删除源目录数据。
          </p>
        </>
      )}
    </div>
  );
}
