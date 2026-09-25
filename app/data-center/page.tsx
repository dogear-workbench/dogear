import { useEffect, useState } from 'react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { client } from '@/lib/client';
import { useSettingsStore } from '@/stores/settings-store';
import { UsagePanel } from './usage-panel';
import { SchedulerPanel } from './scheduler/SchedulerPanel';
import { MemorySection } from './memory-section';
import { HistoryPanel } from './history-panel';
import { VersionBackupPanel } from './version-backup/VersionBackupPanel';
import { BrowserDataPanel } from './browser-data-panel';
import type { Workspace } from '@/types/electron-api';

export default function DataCenterPage() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const settingsLoaded = useSettingsStore((s) => s.loaded);
  const loadSettings = useSettingsStore((s) => s.loadSettings);

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
      <Tabs defaultValue="usage" className="flex-1 flex flex-col overflow-hidden">
        <TabsList variant="underline" className="justify-start px-6 flex-shrink-0">
          <TabsTrigger variant="underline" value="usage">用量</TabsTrigger>
          <TabsTrigger variant="underline" value="scheduler">定时计划</TabsTrigger>
          <TabsTrigger variant="underline" value="history">执行历史</TabsTrigger>
          <TabsTrigger variant="underline" value="memory">记忆</TabsTrigger>
          <TabsTrigger variant="underline" value="version-backup">版本与备份</TabsTrigger>
          <TabsTrigger variant="underline" value="browser-data">浏览器数据</TabsTrigger>
        </TabsList>

        <TabsContent value="usage" className="flex-1 mt-0 overflow-hidden data-[state=inactive]:hidden">
          <div className="h-full overflow-y-auto">
            <UsagePanel workspaces={workspaces} />
          </div>
        </TabsContent>

        <TabsContent value="scheduler" forceMount className="flex-1 mt-0 overflow-hidden data-[state=inactive]:hidden">
          <SchedulerPanel workspaces={workspaces} />
        </TabsContent>

        <TabsContent value="history" className="flex-1 mt-0 overflow-hidden data-[state=inactive]:hidden">
          <div className="h-full overflow-y-auto">
            <HistoryPanel />
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

        <TabsContent value="browser-data" className="flex-1 mt-0 overflow-hidden data-[state=inactive]:hidden">
          <div className="h-full overflow-y-auto">
            <BrowserDataPanel />
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
