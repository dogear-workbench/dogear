import { Loader2, RefreshCw, ShieldCheck } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useSyncStore } from '@/stores/sync-store';
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

  const paired = syncOptions?.pairedDevices.some((d) => d.deviceId === peer.deviceId) ?? false;
  const peerState = syncState?.peers[peer.deviceId];
  const lastSyncAt = peerState?.lastSyncAt;
  const syncing = runningSync !== null;
  const pairingThis = outgoingPairing?.deviceId === peer.deviceId;
  const name = peerDisplayName(peer.name, peer.deviceId);

  return (
    <Card>
      <CardContent className="py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium truncate">{name}</span>
              <Badge variant="subtle" className="shrink-0 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400">
                在线
              </Badge>
              {paired && (
                <Badge variant="subtle" className="shrink-0 gap-1">
                  <ShieldCheck className="w-3 h-3" />
                  已配对
                </Badge>
              )}
            </div>
            <div className="mt-1 text-xs text-muted-foreground flex items-center gap-2 flex-wrap">
              <span className="font-mono">{shortDeviceIdText(peer.deviceId)}</span>
              <span>{peer.host}:{peer.port}</span>
              {peer.appVersion && <span>Dogear {peer.appVersion}</span>}
              <span>
                {lastSyncAt
                  ? `上次同步 ${formatRelativePast(lastSyncAt) || formatDateTimeShort(lastSyncAt)}`
                  : '从未同步'}
              </span>
            </div>
          </div>
          <div className="shrink-0">
            {paired ? (
              <Button size="sm" disabled={syncing} onClick={() => void runSync(peer.deviceId)}>
                {syncing ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    {runningSync?.peerId === peer.deviceId ? '同步中…' : '其他同步进行中'}
                  </>
                ) : (
                  <>
                    <RefreshCw className="w-3.5 h-3.5" />
                    同步
                  </>
                )}
              </Button>
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
            首次同步提示：两端还没有共同基线，同名但内容不同的文件会按冲突保守处理（各自保留 .conflict- 副本，不丢数据），冲突较多属预期。
          </p>
        )}
      </CardContent>
    </Card>
  );
}
