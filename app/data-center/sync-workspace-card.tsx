import { useCallback, useEffect, useState } from 'react';
import { FolderPlus, Link2, RefreshCw, EyeOff } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { client } from '@/lib/client';
import { useSyncStore } from '@/stores/sync-store';
import type { PeerInfo } from '@/electron/main/services/sync/discovery';
import type { Workspace } from '@/electron/main/services/workspace-json-service';
import type { WorkspaceMetaItem } from '@/electron/main/services/sync/workspace-map';
import { formatRelativePast } from './history-utils';
import { shortDeviceIdText } from './sync-utils';

type Overview = Awaited<ReturnType<typeof client.getWorkspaceSyncOverview>>;

/**
 * 工作区同步卡片（step3 / D5）：已映射区（开关/断开）+ 待映射区（接收为新工作区/映射到已有/不同步）
 * + 已忽略区 + 底部全局恒同步说明。建映射成功后 store 自动触发一次仅拉取。
 */
export function SyncWorkspaceCard({ peer }: { peer: PeerInfo }) {
  const syncOptions = useSyncStore((s) => s.syncOptions);
  const lastReport = useSyncStore((s) => s.lastReport);
  const runningSync = useSyncStore((s) => s.runningSync);
  const syncState = useSyncStore((s) => s.syncState);
  const mapWorkspace = useSyncStore((s) => s.mapWorkspace);
  const setWorkspaceSync = useSyncStore((s) => s.setWorkspaceSync);
  const unmapWorkspace = useSyncStore((s) => s.unmapWorkspace);
  const ignoreRemoteWorkspace = useSyncStore((s) => s.ignoreRemoteWorkspace);
  const unignoreRemoteWorkspace = useSyncStore((s) => s.unignoreRemoteWorkspace);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [localWorkspaces, setLocalWorkspaces] = useState<Workspace[]>([]);
  const [busyWsid, setBusyWsid] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const [ov, all] = await Promise.all([
        client.getWorkspaceSyncOverview({ peerId: peer.deviceId }),
        client.getAll(),
      ]);
      setOverview(ov);
      setLocalWorkspaces(all.workspaces ?? []);
    } catch (error) {
      console.error('[sync] 工作区映射概要拉取失败:', error);
    }
  }, [peer.deviceId]);

  useEffect(() => {
    void reload();
  }, [reload, syncState?.peers[peer.deviceId]?.lastSyncAt, syncState?.peers[peer.deviceId]?.workspaceMap]);

  if (!syncOptions?.pairedDevices.some((d) => d.deviceId === peer.deviceId)) return null;

  const mappedRows = overview?.mapped ?? [];
  const ignoredRows = overview?.ignored ?? [];
  const mappedRemote = new Set(mappedRows.map((m) => m.remoteWsid));
  const ignoredIds = new Set(ignoredRows.map((i) => i.wsid));
  // 待映射：最近一次报告里的对端未映射工作区，扣除已建映射/已忽略（报告可能是旧的，以映射表现状为准）
  const pendingRows = (lastReport?.peerId === peer.deviceId ? lastReport?.unmappedWorkspaces ?? [] : [])
    .filter((u) => !mappedRemote.has(u.wsid) && !ignoredIds.has(u.wsid));
  const busy = runningSync !== null;
  const mapableLocal = localWorkspaces.filter((w) => !mappedRows.some((m) => m.localWsid === w.id));

  const receiveAsNew = async (remoteWsid: string, metaName?: string) => {
    setBusyWsid(remoteWsid);
    try {
      const picked = await client.pickDirectory();
      if (picked.canceled || !picked.path) return;
      const ok = await mapWorkspace(peer.deviceId, {
        remoteWsid,
        mode: 'new',
        localPath: picked.path,
        localName: metaName,
      });
      if (ok) toast.success(`已接收工作区「${metaName ?? remoteWsid}」，正在拉取数据…`);
    } catch (error) {
      toast.error('选择目录失败', { description: String(error) });
    } finally {
      setBusyWsid(null);
    }
  };

  const mapToExisting = async (remoteWsid: string, localWsid: string) => {
    setBusyWsid(remoteWsid);
    try {
      const ok = await mapWorkspace(peer.deviceId, { remoteWsid, mode: 'existing', localWsid });
      if (ok) toast.success('已建立映射，正在拉取数据合流…');
    } finally {
      setBusyWsid(null);
    }
  };

  return (
    <Card>
      <CardContent className="py-4 space-y-4">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Link2 className="w-4 h-4 text-muted-foreground shrink-0" />
            工作区同步
          </div>
          <Button variant="ghost" size="sm" className="h-8 w-8 p-0" title="刷新" onClick={() => void reload()}>
            <RefreshCw className="w-3.5 h-3.5" />
          </Button>
        </div>

        {/* 已映射区 */}
        {mappedRows.length > 0 && (
          <ul className="space-y-1.5">
            {mappedRows.map((row) => (
              <li
                key={row.localWsid}
                className="flex items-center gap-3 rounded-md border px-3 py-2 flex-wrap"
              >
                <div className="min-w-0 flex-1 flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium truncate max-w-45">
                    {row.localName ?? `本端 ${shortDeviceIdText(row.localWsid)}`}
                  </span>
                  <span className="text-muted-foreground text-xs">↔</span>
                  <span className="text-sm truncate max-w-45">
                    {row.remoteName ?? `对端 ${shortDeviceIdText(row.remoteWsid)}`}
                  </span>
                  <Badge variant="subtle" className="shrink-0">
                    {row.enabled ? '同步中' : '已暂停'}
                  </Badge>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-xs text-muted-foreground">同步</span>
                  <Switch
                    checked={row.enabled}
                    disabled={busy}
                    onCheckedChange={(v) => void setWorkspaceSync(peer.deviceId, row.localWsid, v).then(() => reload())}
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 text-xs text-destructive hover:text-destructive"
                    disabled={busy}
                    title="断开映射（两侧已有数据不动，不再互通）"
                    onClick={() => void unmapWorkspace(peer.deviceId, row.localWsid).then(() => reload())}
                  >
                    断开
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}

        {/* 待映射区 */}
        {pendingRows.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-amber-600 dark:text-amber-400">
              对端有 {pendingRows.length} 个工作区未建映射，未同步——请为每个工作区选择处理方式：
            </p>
            <ul className="space-y-1.5">
              {pendingRows.map((item: WorkspaceMetaItem) => (
                <li key={item.wsid} className="rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 space-y-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium truncate">
                      {item.name ?? `工作区 ${shortDeviceIdText(item.wsid)}`}
                    </span>
                    <span className="text-xs text-muted-foreground flex items-center gap-2 flex-wrap">
                      {item.conversationCount !== undefined && <span>{item.conversationCount} 个会话</span>}
                      {item.lastUpdated !== undefined && (
                        <span>最后更新 {formatRelativePast(item.lastUpdated) || '刚刚'}</span>
                      )}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <Button
                      size="sm"
                      className="h-8 gap-1"
                      disabled={busy || busyWsid === item.wsid}
                      onClick={() => void receiveAsNew(item.wsid, item.name)}
                    >
                      <FolderPlus className="w-3.5 h-3.5" />
                      接收为新工作区
                    </Button>
                    {mapableLocal.length > 0 && (
                      <Select onValueChange={(localWsid) => void mapToExisting(item.wsid, localWsid)}>
                        <SelectTrigger size="sm" className="h-8 min-w-40" disabled={busy || busyWsid === item.wsid}>
                          <SelectValue placeholder="映射到本端已有…" />
                        </SelectTrigger>
                        <SelectContent>
                          {mapableLocal.map((w) => (
                            <SelectItem key={w.id} value={w.id}>
                              {w.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8 gap-1 text-xs text-muted-foreground"
                      disabled={busy || busyWsid === item.wsid}
                      title="记入忽略列表，不再提示也不再同步；可随时解除"
                      onClick={() =>
                        void ignoreRemoteWorkspace(peer.deviceId, item.wsid).then(() => reload())
                      }
                    >
                      <EyeOff className="w-3.5 h-3.5" />
                      不同步
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* 已忽略区 */}
        {ignoredRows.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-xs text-muted-foreground">已忽略（不同步）的工作区：</p>
            <ul className="space-y-1">
              {ignoredRows.map((item) => (
                <li key={item.wsid} className="flex items-center justify-between gap-2 rounded bg-muted/40 px-2.5 py-1.5">
                  <span className="text-xs truncate">
                    {item.name ?? `工作区 ${shortDeviceIdText(item.wsid)}`}
                    <span className="text-muted-foreground/70 font-mono ml-1.5 text-[10px]">{shortDeviceIdText(item.wsid)}</span>
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 px-2 text-xs shrink-0"
                    onClick={() => void unignoreRemoteWorkspace(peer.deviceId, item.wsid).then(() => reload())}
                  >
                    解除忽略
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {mappedRows.length === 0 && pendingRows.length === 0 && ignoredRows.length === 0 && (
          <p className="text-xs text-muted-foreground">
            尚未建立任何工作区映射。点一次同步后，对端的工作区会出现在「上次同步结果」的待映射清单中，逐个选择处理方式即可。
          </p>
        )}

        <p className="text-xs text-muted-foreground/80">
          全局数据（设置、计划、记忆、通知等）恒定同步，不可关闭；仅工作区数据按上面的映射与开关选择性同步。
          未映射的对端工作区目录不会落盘，映射必须显式建立。
        </p>
      </CardContent>
    </Card>
  );
}
