import { ChevronDown, Loader2, RefreshCw, ShieldCheck, Unlink } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useSyncStore } from '@/stores/sync-store';
import { showConfirm } from '@/stores/confirm-store';
import type { PeerInfo } from '@/electron/main/services/sync/discovery';
import { formatDateTimeShort, formatRelativePast } from './history-utils';
import { peerDisplayName, shortDeviceIdText } from './sync-utils';

export function SyncPeerCard({ peer }: { peer: PeerInfo }) {
  const syncOptions = useSyncStore((s) => s.syncOptions);
  const syncState = useSyncStore((s) => s.syncState);
  const runningSync = useSyncStore((s) => s.runningSync);
  const outgoingPairing = useSyncStore((s) => s.outgoingPairing);
  const runSync = useSyncStore((s) => s.runSync);
  const requestPair = useSyncStore((s) => s.requestPair);
  const unpair = useSyncStore((s) => s.unpair);

  const paired = syncOptions?.pairedDevices.some((d) => d.deviceId === peer.deviceId) ?? false;
  const peerState = syncState?.peers[peer.deviceId];
  const lastSyncAt = peerState?.lastSyncAt;
  const syncing = runningSync !== null;
  const pairingThis = outgoingPairing?.deviceId === peer.deviceId;
  const name = peerDisplayName(peer.name, peer.deviceId);

  const handleUnpair = async () => {
    const ok = await showConfirm(
      '解除配对',
      `确定解除与「${name}」的配对吗？仅解除信任关系，同步基线与工作区映射会保留，重新配对后可接着同步；对端需在其设备上另行解除配对。`,
    );
    if (ok) await unpair(peer.deviceId);
  };

  return (
    <Card>
      <CardContent className="py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium truncate">{name}</span>
              {peer.online ? (
                <Badge variant="subtle" className="shrink-0 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400">
                  在线
                </Badge>
              ) : (
                <Badge variant="subtle" className="shrink-0">离线</Badge>
              )}
              {paired && (
                <Badge variant="subtle" className="shrink-0 gap-1">
                  <ShieldCheck className="w-3 h-3" />
                  已配对
                </Badge>
              )}
            </div>
            <div className="mt-1 text-xs text-muted-foreground flex items-center gap-2 flex-wrap">
              <span className="font-mono">{shortDeviceIdText(peer.deviceId)}</span>
              {peer.host && peer.port ? <span>{peer.host}:{peer.port}</span> : <span>地址未知</span>}
              {peer.appVersion && <span>Dogear {peer.appVersion}</span>}
              <span>
                {lastSyncAt
                  ? `上次同步 ${formatRelativePast(lastSyncAt) || formatDateTimeShort(lastSyncAt)}`
                  : '从未同步'}
              </span>
            </div>
          </div>
          <div className="shrink-0 flex items-center gap-1">
            {paired ? (
              <>
                {/* 主按钮默认仅拉取（对端不被修改）；换新设备首次灌数据可在菜单选仅推送 */}
                <Button
                  size="sm"
                  disabled={syncing}
                  onClick={() => void runSync(peer.deviceId, { direction: 'pull' })}
                >
                  {syncing ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      {runningSync?.peerId === peer.deviceId ? '同步中…' : '其他同步进行中'}
                    </>
                  ) : (
                    <>
                      <RefreshCw className="w-3.5 h-3.5" />
                      仅拉取同步
                    </>
                  )}
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    {/* 菜单打开前拦住：disabled 项 pointer-events-none，title 提示只能放 trigger 上 */}
                    <Button
                      size="sm"
                      variant="outline"
                      className="px-1.5"
                      disabled={syncing}
                      title={syncing ? '同步进行中，稍后再解除' : '选择同步方向'}
                    >
                      <ChevronDown className="w-3.5 h-3.5" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => void runSync(peer.deviceId, { direction: 'pull' })}>
                      <div className="flex flex-col">
                        <span>仅拉取（默认）</span>
                        <span className="text-xs text-muted-foreground">把此设备数据拉到本机，对端不被修改</span>
                      </div>
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => void runSync(peer.deviceId, { direction: 'push' })}>
                      <div className="flex flex-col">
                        <span>仅推送</span>
                        <span className="text-xs text-muted-foreground">把本机数据灌到此设备，本机不变</span>
                      </div>
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => void runSync(peer.deviceId, { direction: 'both' })}>
                      <div className="flex flex-col">
                        <span>双向</span>
                        <span className="text-xs text-muted-foreground">两侧互拉，冲突会挂起待选择</span>
                      </div>
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      disabled={syncing}
                      className="text-destructive focus:text-destructive focus:bg-destructive/10"
                      onClick={() => void handleUnpair()}
                    >
                      <Unlink className="w-3.5 h-3.5" />
                      解除配对
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </>
            ) : (
              <Button size="sm" variant="outline" disabled={pairingThis} onClick={() => void requestPair(peer)}>
                {pairingThis ? '配对中…' : '配对'}
              </Button>
            )}
          </div>
        </div>

        {pairingThis && (
          <div className="mt-3 rounded-md border bg-muted/40 px-3 py-2.5 flex items-center gap-3">
            <span className="text-xs text-muted-foreground shrink-0">请在对方设备的配对请求中确认此码：</span>
            <span className="font-mono text-lg font-semibold tracking-[0.3em]">{outgoingPairing?.code}</span>
            <span className="text-xs text-muted-foreground">等待对方确认…</span>
          </div>
        )}

        {paired && !lastSyncAt && !pairingThis && (
          <p className="mt-3 text-xs text-muted-foreground">
            首次同步提示：两端还没有共同基线，同名但内容不同的文件会按冲突处理——默认仅拉取会自动取较新一侧（败方留 .conflict- 副本，选错可换回）；
            若用双向同步则会列为待处理冲突，可按大类一键选择。首次交接建议在旧设备数据拉过来后核对结果。
          </p>
        )}
      </CardContent>
    </Card>
  );
}
