import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Unlink } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useSyncStore } from '@/stores/sync-store';
import { showConfirm } from '@/stores/confirm-store';
import { SYNC_ITEM_IDS, type SyncItemMeta } from '@/electron/main/services/settings-types';
import { formatDateTimeShort } from './history-utils';
import { peerDisplayName, shortDeviceIdText } from './sync-utils';

/** 关闭 workspaces 的二次确认文案：影响面大（全部工作区数据不再跨设备），必须显式确认 */
async function confirmDisableWorkspaces(): Promise<boolean> {
  return showConfirm(
    '关闭工作区数据同步？',
    '关闭后所有工作区的会话、笔记、记忆等数据都不再跨设备，两端数据会逐渐分叉。确定关闭吗？',
  );
}

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

  /**
   * 12 项统一切换：stocks/feishu 走独立布尔键（底层键不变），其余项增删 disabledSyncItems。
   * 修改即调 setSyncOptions，范围字段变化由主进程 syncOptionsRev++ 并随同步两端统一。
   */
  const toggleItem = async (meta: SyncItemMeta, on: boolean) => {
    if (meta.id === 'stocks') {
      await updateSyncOptions({ syncStocksData: on });
      return;
    }
    if (meta.id === 'feishu') {
      await updateSyncOptions({ syncFeishu: on });
      return;
    }
    if (!on && meta.id === 'workspaces') {
      const ok = await confirmDisableWorkspaces();
      if (!ok) return;
    }
    const current = syncOptions.disabledSyncItems ?? [];
    const next = on ? current.filter((id) => id !== meta.id) : [...current, meta.id];
    await updateSyncOptions({ disabledSyncItems: next });
  };

  const isItemOn = (meta: SyncItemMeta): boolean => {
    if (meta.id === 'stocks') return syncOptions.syncStocksData === true;
    if (meta.id === 'feishu') return syncOptions.syncFeishu === true;
    return !(syncOptions.disabledSyncItems ?? []).includes(meta.id);
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

        <div className="space-y-3">
          <div>
            <Label className="text-sm">同步范围</Label>
            <p className="mt-0.5 text-xs text-muted-foreground">
              控制哪些数据参与设备同步，改动即时保存；范围设置随同步跨设备统一（以最近修改的设备为准）。
            </p>
          </div>
          <ul className="space-y-0.5">
            {SYNC_ITEM_IDS.map((meta) => (
              <li key={meta.id} className="flex items-center justify-between gap-3 py-1">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-sm">
                    <span className="truncate">{meta.name}</span>
                    <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{meta.id}</span>
                    {meta.required && (
                      <span title="同步配对与范围配置本身，关闭会导致设置无法跨设备统一" className="shrink-0">
                        <Badge variant="subtle" className="text-[10px]">
                          必选
                        </Badge>
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground">{meta.description}</div>
                </div>
                <Switch
                  checked={meta.required ? true : isItemOn(meta)}
                  disabled={!!meta.required}
                  onCheckedChange={(v) => void toggleItem(meta, v)}
                />
              </li>
            ))}
          </ul>

          {/* 两个专项开关（默认关）：本端保护性数据，跨端共享有已知风险，详见各项说明 */}
          <div className="space-y-0.5 rounded-md border p-3">
            <ToggleRow
              checked={syncOptions.syncShadowGit === true}
              onChecked={(v) => void updateSyncOptions({ syncShadowGit: v })}
              label="同步影子快照仓库（shadow-git）"
              hint="影子快照是本机文件历史的 git 安全网，默认不跨设备；开启后快照历史将跨设备共享，但两端并发快照时可能产生 git 内部文件冲突甚至损坏，建议保持关闭"
            />
            <ToggleRow
              checked={syncOptions.syncConflictCopies === true}
              onChecked={(v) => void updateSyncOptions({ syncConflictCopies: v })}
              label="同步冲突留底副本（.conflict-*）"
              hint="同步冲突时自动保留的败方完整内容副本，默认仅留在产生冲突的设备上供手动换回，不跨设备传播"
            />
          </div>
        </div>

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

function ToggleRow({
  checked,
  onChecked,
  label,
  hint,
}: {
  checked: boolean;
  onChecked: (v: boolean) => void;
  label: string;
  hint: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-1">
      <div>
        <div className="text-sm">{label}</div>
        <div className="text-xs leading-5 text-muted-foreground">{hint}</div>
      </div>
      <Switch checked={checked} onCheckedChange={onChecked} />
    </div>
  );
}
