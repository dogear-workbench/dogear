import { useEffect, useState } from 'react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { client } from '@/lib/client';
import { useSettingsStore } from '@/stores/settings-store';
import { useSyncStore } from '@/stores/sync-store';
import { DataCenterSearchProvider } from './DataCenterSearchProvider';
import { useDataCenterFocusStore } from './memory-focus';
import { UsagePanel } from './usage-panel';
import { MemorySection } from './memory-section';
import { VersionBackupPanel } from './version-backup/VersionBackupPanel';
import { SyncPanel } from './sync-panel';
import type { Workspace } from '@/types/electron-api';

export default function DataCenterPage() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [tab, setTab] = useState('usage');
  const syncPanelFocusAt = useSyncStore((s) => s.syncPanelFocusAt);
  const settingsLoaded = useSettingsStore((s) => s.loaded);
  const loadSettings = useSettingsStore((s) => s.loadSettings);

  // 通知中心「前往同步」跳转：切到设备同步 tab 后消费焦点请求（事件订阅在 App 根层全局挂）
  useEffect(() => {
    if (syncPanelFocusAt > 0) {
      setTab('sync');
      useSyncStore.getState().consumeSyncPanelFocus();
    }
  }, [syncPanelFocusAt]);

  // 顶栏记忆搜索命中：切到记忆面板；定位（选工作区/选中主题）由 MemorySection 消费同一请求
  useEffect(() => {
    const unsub = useDataCenterFocusStore.subscribe((s) => {
      if (s.memoryTopicReq) setTab('memory');
    });
    return unsub;
  }, []);

  useEffect(() => {
    client.getAll()
      .then((r) => setWorkspaces(r.workspaces ?? []))
      .catch((e) => console.error('加载工作区列表失败:', e));
  }, []);

  useEffect(() => {
    if (!settingsLoaded) loadSettings();
  }, [settingsLoaded, loadSettings]);

  return (
    <div className="h-full flex flex-col">
      <DataCenterSearchProvider />
      <Tabs value={tab} onValueChange={setTab} className="flex-1 flex flex-col overflow-hidden">
        <TabsList variant="underline" className="justify-start px-6 flex-shrink-0">
          <TabsTrigger variant="underline" value="usage">用量</TabsTrigger>
          <TabsTrigger variant="underline" value="memory">记忆与资产</TabsTrigger>
          <TabsTrigger variant="underline" value="version-backup">版本与备份</TabsTrigger>
          <TabsTrigger variant="underline" value="sync">设备同步</TabsTrigger>
        </TabsList>

        <TabsContent value="usage" className="flex-1 mt-0 overflow-hidden data-[state=inactive]:hidden">
          <div className="h-full overflow-y-auto">
            <UsagePanel workspaces={workspaces} />
          </div>
        </TabsContent>

        <TabsContent value="memory" className="flex-1 mt-0 overflow-hidden data-[state=inactive]:hidden">
          <div className="h-full overflow-y-auto">
            <MemorySection workspaces={workspaces} />
          </div>
        </TabsContent>

        <TabsContent value="version-backup" className="flex-1 mt-0 overflow-hidden data-[state=inactive]:hidden">
          <div className="h-full overflow-y-auto">
            <VersionBackupPanel workspaces={workspaces} />
          </div>
        </TabsContent>

        <TabsContent value="sync" className="flex-1 mt-0 overflow-hidden data-[state=inactive]:hidden">
          <div className="h-full overflow-y-auto">
            <SyncPanel />
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
