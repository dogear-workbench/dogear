import { useEffect, useMemo, useState } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { client } from '@/lib/client';
import type { Workspace } from '@/electron/main/services/workspace-json-service';
import type { SyncOptions } from '@/electron/main/services/settings-types';
import { useSyncStore } from '@/stores/sync-store';
import { SyncUserPathsTree } from './sync-user-paths-tree';
import { toggleUserSyncPath, userSyncPathsListEqual, userSyncPathsForWorkspaces } from './user-sync-paths';

/** 用户文件勾选区：工作区选择 + 敏感提示 + 目录树；勾选写 setSyncOptions（userSyncPaths，rev 由主进程维护） */
export function UserSyncPathsSection({ syncOptions }: { syncOptions: SyncOptions }) {
  const updateSyncOptions = useSyncStore((s) => s.updateSyncOptions);
  const [workspaces, setWorkspaces] = useState<Workspace[] | null>(null);
  const selectable = useMemo(() => (workspaces ?? []).filter((w) => w.path !== ''), [workspaces]);
  const [wsId, setWsId] = useState('');

  useEffect(() => {
    let alive = true;
    client
      .getAll({})
      .then((r) => {
        if (!alive) return;
        const list = r.workspaces.filter((w) => w.path !== '');
        setWorkspaces(list);
        setWsId((cur) => (cur !== '' && list.some((w) => w.id === cur) ? cur : (list.find((w) => w.isDefault) ?? list[0])?.id ?? ''));
      })
      .catch(() => {
        if (alive) setWorkspaces([]);
      });
    return () => {
      alive = false;
    };
  }, []);

  const checkedPaths = userSyncPathsForWorkspaces(syncOptions.userSyncPaths, wsId);

  const handleToggle = (relPath: string, on: boolean) => {
    const next = toggleUserSyncPath(checkedPaths, relPath, on);
    if (userSyncPathsListEqual(next, checkedPaths)) return;
    void updateSyncOptions({ userSyncPaths: { ...(syncOptions.userSyncPaths ?? {}), [wsId]: next } });
  };

  if (workspaces !== null && selectable.length === 0) {
    return <p className="text-xs text-muted-foreground">还没有可选的工作区，先在工作台添加一个本地文件夹工作区。</p>;
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        勾选的目录将跨设备同步，敏感文件请勿勾选。生成物（dist / node_modules 等）不建议勾选，自动识别将在后续版本提供。
      </p>
      <div className="flex items-center gap-2">
        <Select value={wsId} onValueChange={setWsId} disabled={selectable.length === 0}>
          <SelectTrigger className="h-8 w-64 text-sm">
            <SelectValue placeholder="选择工作区" />
          </SelectTrigger>
          <SelectContent>
            {selectable.map((w) => (
              <SelectItem key={w.id} value={w.id}>
                {w.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {wsId !== '' && (
        <SyncUserPathsTree workspaceId={wsId} checkedPaths={checkedPaths} onToggle={handleToggle} />
      )}
      <p className="text-[11px] text-muted-foreground">
        勾选改动即时保存，并随同步范围设置跨设备统一（以最近修改的设备为准）。
      </p>
    </div>
  );
}
