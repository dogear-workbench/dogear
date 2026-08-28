import { useEffect, useState } from 'react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { client } from '@/lib/client';
import { useSettingsStore } from '@/stores/settings-store';
import { DigestsPanel } from './digests-panel';
import { UsagePanel } from './usage-panel';
import { SchedulerPanel } from './scheduler/SchedulerPanel';
import { ParseHistoryPanel } from './parse-history-panel';
import { MemorySection } from './memory-section';
import { HistoryPanel } from './history-panel';
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
      <Tabs defaultValue="digests" className="flex-1 flex flex-col overflow-hidden">
        <TabsList variant="underline" className="justify-start px-6 flex-shrink-0">
          <TabsTrigger variant="underline" value="digests">组卡</TabsTrigger>
          <TabsTrigger variant="underline" value="usage">用量</TabsTrigger>
          <TabsTrigger variant="underline" value="scheduler">定时计划</TabsTrigger>
          <TabsTrigger variant="underline" value="history">执行历史</TabsTrigger>
          <TabsTrigger variant="underline" value="parse-history">解析历史</TabsTrigger>
          <TabsTrigger variant="underline" value="memory">记忆</TabsTrigger>
        </TabsList>

        <TabsContent value="digests" className="flex-1 mt-0 overflow-hidden data-[state=inactive]:hidden">
          <div className="h-full overflow-y-auto">
            <DigestsPanel workspaces={workspaces} />
          </div>
        </TabsContent>

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

        <TabsContent value="parse-history" className="flex-1 mt-0 overflow-hidden data-[state=inactive]:hidden">
          <div className="h-full overflow-y-auto">
            <ParseHistoryPanel />
          </div>
        </TabsContent>

        <TabsContent value="memory" className="flex-1 mt-0 overflow-hidden data-[state=inactive]:hidden">
          <div className="h-full overflow-y-auto">
            <MemorySection workspaces={workspaces} />
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
