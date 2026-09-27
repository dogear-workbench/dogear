import { useEffect, useState } from 'react';
import { AlertTriangle, HardDrive, MonitorSmartphone, RefreshCw, WifiOff } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useSyncStore } from '@/stores/sync-store';
import { PairRequestCards } from './sync-pair-requests';
import { SyncPeerCard } from './sync-peer-card';
import { SyncResultCard } from './sync-result';
import { SyncSettingsCard } from './sync-settings';
import { SyncWorkspaceCard } from './sync-workspace-card';
import { shortDeviceIdText } from './sync-utils';

const CLOCK_TICK_MS = 30_000;

export function SyncPanel() {
  const peers = useSyncStore((s) => s.peers);
  const [now, setNow] = useState(Date.now);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), CLOCK_TICK_MS);
    return () => clearInterval(timer);
  }, []);

  return (
    // max-w 放宽（4xl → 6xl，step3 3E）：冲突处理区域与工作区同步卡片内容多，1920 宽下无横向滚动
    <div className="mx-auto max-w-6xl px-6 py-6 space-y-4">
      <SelfStatusCard />

      <PairRequestCards now={now} />

      <section className="space-y-2">
        <h3 className="text-sm font-semibold text-muted-foreground">在线设备</h3>
        {peers.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-sm text-muted-foreground space-y-2">
              <MonitorSmartphone className="w-6 h-6 mx-auto text-muted-foreground/50" />
              <p>局域网内暂未发现其他设备。</p>
              <p className="text-xs">请确认另一台设备已打开 Dogear 且与本机在同一网络。首次可能被系统防火墙拦截，放行后重试。</p>
            </CardContent>
          </Card>
        ) : (
          peers.map((peer) => (
            <div key={peer.deviceId} className="space-y-2">
              <SyncPeerCard peer={peer} />
              <SyncWorkspaceCard peer={peer} />
            </div>
          ))
        )}
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold text-muted-foreground">上次同步结果</h3>
        <SyncResultCard />
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold text-muted-foreground">同步设置</h3>
        <SyncSettingsCard />
      </section>
    </div>
  );
}

function SelfStatusCard() {
  const status = useSyncStore((s) => s.status);
  const runningSync = useSyncStore((s) => s.runningSync);
  const refresh = useSyncStore((s) => s.refresh);

  return (
    <Card>
      <CardContent className="py-4">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <HardDrive className="w-4 h-4 text-muted-foreground shrink-0" />
              <span className="text-sm font-medium truncate">
                本机：{status?.deviceName || '未知设备'}
              </span>
              {status?.running ? (
                <Badge variant="subtle" className="shrink-0 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400">
                  同步服务已开启
                </Badge>
              ) : (
                <Badge variant="subtle" className="shrink-0">未开启</Badge>
              )}
            </div>
            <div className="mt-1 text-xs text-muted-foreground flex items-center gap-2 flex-wrap">
              {status?.deviceId && <span className="font-mono">{shortDeviceIdText(status.deviceId)}</span>}
              {status?.httpPort !== undefined && <span>端口 {status.httpPort}</span>}
              {runningSync && <span>同步进行中…</span>}
            </div>
          </div>
          <Button variant="ghost" size="sm" className="h-8 w-8 p-0 shrink-0" title="刷新状态" onClick={() => void refresh()}>
            <RefreshCw className="w-3.5 h-3.5" />
          </Button>
        </div>
        {status?.discoveryError && (
          <p className="mt-2 text-xs text-amber-600 dark:text-amber-400 flex items-start gap-1">
            <WifiOff className="w-3 h-3 mt-0.5 shrink-0" />
            局域网发现不可用：{status.discoveryError}。请在系统防火墙中放行 Dogear 后重启应用。
          </p>
        )}
        {status?.error && (
          <p className="mt-2 text-xs text-destructive flex items-start gap-1">
            <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
            同步服务启动失败：{status.error}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
