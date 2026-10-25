import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import { toast } from 'sonner';
import { showConfirm } from '@/stores/confirm-store';
import { client } from '@/lib/client';
import type { Workspace } from '@/types/electron-api';
import type { AppSettings } from '@/types/settings';
import { SNAPSHOT_SETTING_DEFAULTS } from '@/electron/main/services/settings-types';
import { useWorkspaceStore } from '@/stores/workspace-store';
import { SnapshotConfigSection, type ShadowSnapshotSummary } from './SnapshotConfigSection';
import { WorkspaceDetail } from './WorkspaceDetail';
import { WorkspaceListNav } from './WorkspaceListNav';
import { OrphansPanel } from './OrphansPanel';
import type { SettingsSearchEntry } from './search-index';

export const WORKSPACE_MANAGEMENT_SEARCH_ENTRIES: SettingsSearchEntry[] = [
  { label: '添加工作区', description: '选择文件夹加入工作区列表', keywords: ['新建', '创建'] },
  { label: '工作区列表', description: '选择工作区查看详情：路径、删除、快照开关、排除目录' },
  { label: '自动快照 · 此工作区', description: '快照开关与排除目录，按工作区独立设置' },
  { label: '快照全局规则', description: '单文件阈值、保留窗口、存量瘦身、恢复默认', keywords: ['snapshot'] },
  { label: '存量瘦身', description: '清理历史快照释放空间' },
  { label: '丢失的会话', description: '扫描未关联工作区的历史会话，并入任意工作区或舍弃', keywords: ['导入', '恢复'] },
];

interface Props {
  local: AppSettings;
  setLocal: Dispatch<SetStateAction<AppSettings>>;
}

export function WorkspaceManagementTab({ local, setLocal }: Props) {
  const currentWorkspace = useWorkspaceStore((s) => s.workspace);
  const clearWorkspace = useWorkspaceStore((s) => s.clearWorkspace);

  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [loading, setLoading] = useState(false);
  const [adding, setAdding] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [orphanMode, setOrphanMode] = useState(false);

  const [snapshotSummaries, setSnapshotSummaries] = useState<Record<string, ShadowSnapshotSummary>>({});
  const [gitAvailable, setGitAvailable] = useState<boolean | null>(null);

  const loadWorkspaces = useCallback(async () => {
    setLoading(true);
    try {
      const result = await client.getAll();
      const list = result.workspaces ?? [];
      setWorkspaces(list);
      setSelectedId((prev) => (prev && list.some((w) => w.id === prev) ? prev : list[0]?.id ?? null));
    } catch (err) {
      console.error('加载工作区列表失败:', err);
      toast.error('加载失败', {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadWorkspaces();
  }, [loadWorkspaces]);

  const loadSnapshotSummaries = useCallback(async (list: Workspace[]) => {
    try {
      const cap = await client.getGitCapability();
      setGitAvailable(cap.available);
      if (!cap.available) {
        setSnapshotSummaries({});
        return;
      }
      const results = await Promise.all(
        list.map(async (w) => {
          const r = await client.getShadowSnapshotSummary({ workspaceId: w.id });
          return [w.id, 'snapshotCount' in r ? r : null] as const;
        }),
      );
      const next: Record<string, ShadowSnapshotSummary> = {};
      for (const [id, s] of results) {
        if (s) next[id] = s;
      }
      setSnapshotSummaries(next);
    } catch {
      // 摘要加载失败静默降级，开关仍可用
    }
  }, []);

  useEffect(() => {
    if (workspaces.length > 0) void loadSnapshotSummaries(workspaces);
  }, [workspaces, loadSnapshotSummaries]);

  const snapshot = local.snapshot ?? structuredClone(SNAPSHOT_SETTING_DEFAULTS);
  const disabledWorkspaceIds = snapshot.disabledWorkspaces ?? [];
  const selectedWorkspace = workspaces.find((w) => w.id === selectedId) ?? null;

  const handleAddWorkspace = async () => {
    setAdding(true);
    try {
      const result = await client.selectFolder();
      if (result.canceled || !result.workspace) return;
      const folderPath = result.workspace.path;
      // 校验：SDK 会把中文或下划线转换成连字符导致历史会话路径错位
      if (/[一-龥_]/.test(folderPath)) {
        toast.warning('路径包含不支持的字符', {
          description: '工作区路径不能包含中文或下划线（_），请选择其他文件夹',
          duration: 6000,
        });
        return;
      }
      await loadWorkspaces();
      setSelectedId(result.workspace.id);
      setOrphanMode(false);
      if (result.existed) {
        toast.info(`「${result.workspace.name}」已在工作区列表中`);
      } else {
        toast.success(`已添加工作区「${result.workspace.name}」`);
      }
    } catch (err) {
      console.error('添加工作区失败:', err);
      toast.error('添加工作区失败', {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setAdding(false);
    }
  };

  const handleToggleSnapshot = (ws: Workspace, enabled: boolean) => {
    const next = enabled
      ? disabledWorkspaceIds.filter((id) => id !== ws.id)
      : [...disabledWorkspaceIds, ws.id];
    setLocal((prev) => ({
      ...prev,
      snapshot: {
        ...(prev.snapshot ?? structuredClone(SNAPSHOT_SETTING_DEFAULTS)),
        disabledWorkspaces: next,
      },
    }));
  };

  const removeExcludedPath = async (ws: Workspace, relPath: string) => {
    const res = await client.removeSnapshotExcludedPath({ workspaceId: ws.id, relPath });
    if ('error' in res) {
      toast.error(res.error);
      return;
    }
    setLocal((prev) => {
      const base = prev.snapshot ?? structuredClone(SNAPSHOT_SETTING_DEFAULTS);
      const excludedPaths = { ...base.excludedPaths };
      if (res.paths.length > 0) {
        excludedPaths[ws.id] = res.paths;
      } else {
        delete excludedPaths[ws.id];
      }
      return { ...prev, snapshot: { ...base, excludedPaths } };
    });
  };

  const handleDelete = async (ws: Workspace) => {
    const ok = await showConfirm(
      '删除工作区',
      `确定要移除工作区「${ws.name}」吗？（不会删除文件夹内容）`,
    );
    if (!ok) return;
    try {
      await client.deleteWorkspace({ workspaceId: ws.id });
      // 如果删除的是当前激活工作区，清空当前
      if (currentWorkspace?.id === ws.id) {
        clearWorkspace();
      }
      await loadWorkspaces();
      toast.success(`已删除工作区「${ws.name}」`);
    } catch (err) {
      console.error('删除工作区失败:', err);
      toast.error('删除失败', {
        description: err instanceof Error ? err.message : String(err),
      });
    }
  };

  return (
    <div className="h-full flex flex-col">
      <div className="px-6 pt-6 pb-4 shrink-0">
        <h2 className="text-lg font-semibold mb-1">工作区管理</h2>
        <p className="text-sm text-muted-foreground">管理工作区与自动快照</p>
      </div>

      <div className="flex-1 min-h-0 flex items-stretch">
        <WorkspaceListNav
          workspaces={workspaces}
          loading={loading}
          currentWorkspaceId={currentWorkspace?.id ?? null}
          disabledWorkspaceIds={disabledWorkspaceIds}
          selectedId={selectedId}
          orphanMode={orphanMode}
          onSelectWorkspace={(id) => {
            setSelectedId(id);
            setOrphanMode(false);
          }}
          onSelectOrphans={() => setOrphanMode(true)}
          onAddWorkspace={() => void handleAddWorkspace()}
          adding={adding}
        />

        <div className="flex-1 min-w-0 max-w-[820px] pl-6 pr-6 py-3 overflow-y-auto">
          {orphanMode ? (
            <OrphansPanel workspaces={workspaces} />
          ) : selectedWorkspace ? (
            <>
              <WorkspaceDetail
                key={selectedWorkspace.id}
                workspace={selectedWorkspace}
                isActive={currentWorkspace?.id === selectedWorkspace.id}
                summary={snapshotSummaries[selectedWorkspace.id] ?? null}
                gitAvailable={gitAvailable}
                snapshotEnabled={!disabledWorkspaceIds.includes(selectedWorkspace.id)}
                onToggleSnapshot={(enabled) => handleToggleSnapshot(selectedWorkspace, enabled)}
                excludedPaths={snapshot.excludedPaths[selectedWorkspace.id] ?? []}
                onRemoveExcludedPath={(relPath) => void removeExcludedPath(selectedWorkspace, relPath)}
                onDelete={() => void handleDelete(selectedWorkspace)}
              />
              <div className="mt-6">
                <SnapshotConfigSection
                  local={local}
                  setLocal={setLocal}
                  workspaces={workspaces}
                  summaries={snapshotSummaries}
                  onRefreshSummaries={() => void loadSnapshotSummaries(workspaces)}
                />
              </div>
            </>
          ) : (
            <div className="py-12 text-sm text-muted-foreground">
              {workspaces.length === 0
                ? '还没有工作区，点击左侧「添加工作区」选择文件夹创建。'
                : '在左侧选择一个工作区'}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
