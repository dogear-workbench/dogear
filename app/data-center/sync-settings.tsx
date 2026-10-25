import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Unlink } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useSyncStore } from '@/stores/sync-store';
import { showConfirm } from '@/stores/confirm-store';
import { formatDateTimeShort } from './history-utils';
import { peerDisplayName, shortDeviceIdText } from './sync-utils';
import { SyncScopeSection } from './sync-scope';

export function SyncSettingsCard() {
  const syncOptions = useSyncStore((s) => s.syncOptions);
  const updateSyncOptions = useSyncStore((s) => s.updateSyncOptions);
  const [deviceName, setDeviceName] = useState('');

  useEffect(() => {
    setDeviceName(syncOptions?.deviceName ?? '');
  }, [syncOptions?.deviceName]);

  if (!syncOptions) return null;

  const saveDeviceName = () => {
    if (deviceName.trim() === (syncOptions.deviceName ?? '')) return;
    void updateSyncOptions({ deviceName: deviceName.trim() });
  };

  const removeDevice = async (deviceId: string, name: string) => {
    const ok = await showConfirm(
      `解除与「${name}」的配对`,
      '解除后两侧都无法再同步，需要重新配对。本地数据不受影响。',
    );
    if (!ok) return;
    await updateSyncOptions({ removeDeviceId: deviceId });
    toast.success('已解除配对');
  };

  return (
    <Card>
      <CardContent className="py-4 space-y-5">
        <div className="space-y-1.5">
          <Label className="text-sm">本机设备名</Label>
          <div className="flex gap-2 max-w-sm">
            <Input
              value={deviceName}
              onChange={(e) => setDeviceName(e.target.value)}
              onBlur={saveDeviceName}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              }}
              placeholder="留空则使用主机名"
            />
          </div>
        </div>

        <SyncScopeSection />

        <div className="space-y-2">
          <Label className="text-sm">已配对设备（{syncOptions.pairedDevices.length}）</Label>
          {syncOptions.pairedDevices.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              还没有已配对设备。两台设备都打开 Dogear 后，在上方在线设备卡片点「配对」开始。
            </p>
          ) : (
            <ul className="space-y-1.5">
              {syncOptions.pairedDevices.map((d) => (
                <li
                  key={d.deviceId}
                  className="flex items-center justify-between gap-2 rounded-md border px-3 py-2"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-sm">
                      <span className="truncate">{peerDisplayName(d.deviceName, d.deviceId)}</span>
                      <Badge variant="subtle" className="shrink-0 font-mono text-[10px]">
                        {shortDeviceIdText(d.deviceId)}
                      </Badge>
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      配对于 {formatDateTimeShort(d.pairedAt)}
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 gap-1 text-xs text-destructive hover:text-destructive shrink-0"
                    onClick={() => void removeDevice(d.deviceId, peerDisplayName(d.deviceName, d.deviceId))}
                  >
                    <Unlink className="w-3 h-3" />
                    解除配对
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
