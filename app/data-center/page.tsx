import { useEffect, useState } from 'react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { client } from '@/lib/client';
import { useSettingsStore } from '@/stores/settings-store';
import { DigestsPanel } from './digests-panel';
import { UsagePanel } from './usage-panel';
import { SchedulerPanel } from './scheduler/SchedulerPanel';
import { ParseHistoryPanel } from './parse-history-panel';
import { MemorySection } from './memory-section';
import type { Workspace } from '@/types/electron-api';

export default function DataCenterPage() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspaceId, setWorkspaceId] = useState<string>('all');
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
    <div className="h-screen flex flex-col">
      <header className="h-12 border-b flex items-center px-4 gap-3 bg-background flex-shrink-0">
        <h1 className="font-semibold">数据中心</h1>
        <div className="flex-1" />
        <select
          className="h-8 px-2 text-sm border rounded bg-background"
          value={workspaceId}
          onChange={(e) => setWorkspaceId(e.target.value)}
        >
          <option value="all">全部工作区</option>
          {workspaces.map((ws) => (
            <option key={ws.id} value={ws.id}>{ws.name}</option>
          ))}
        </select>
      </header>

      <Tabs defaultValue="digests" orientation="vertical" className="flex-1 flex overflow-hidden">
        <TabsList className="flex flex-col h-auto items-stretch gap-1 rounded-none border-r bg-muted/30 p-2 w-36 flex-shrink-0">
          <TabsTrigger value="digests" className="justify-start px-3 py-2 data-[state=active]:bg-background">
            组卡
          </TabsTrigger>
          <TabsTrigger value="usage" className="justify-start px-3 py-2 data-[state=active]:bg-background">
            用量
          </TabsTrigger>
          <TabsTrigger value="scheduler" className="justify-start px-3 py-2 data-[state=active]:bg-background">
            定时计划
          </TabsTrigger>
          <TabsTrigger value="parse-history" className="justify-start px-3 py-2 data-[state=active]:bg-background">
            解析历史
          </TabsTrigger>
          <TabsTrigger value="memory" className="justify-start px-3 py-2 data-[state=active]:bg-background">
            记忆
          </TabsTrigger>
        </TabsList>

        <TabsContent value="digests" className="flex-1 overflow-y-auto mt-0 p-0 data-[state=inactive]:hidden">
          <div className="max-w-5xl py-6 px-6">
            <h2 className="text-lg font-semibold mb-1">组卡</h2>
            <p className="text-sm text-muted-foreground mb-6">
              后台自动把每个会话提炼成摘要卡，可查看组卡详情或对单个组补跑提炼；提炼模型与提示词在「定时计划」的任务编辑器中配置。
            </p>
            <DigestsPanel workspaceId={workspaceId} workspaces={workspaces} />
          </div>
        </TabsContent>

        <TabsContent value="usage" className="flex-1 overflow-y-auto mt-0 p-0 data-[state=inactive]:hidden">
          <UsagePanel workspaceId={workspaceId} workspaces={workspaces} />
        </TabsContent>

        <TabsContent value="scheduler" className="flex-1 overflow-y-auto mt-0 p-0 data-[state=inactive]:hidden">
          <div className="max-w-4xl py-6 px-6">
            <h2 className="text-lg font-semibold mb-1">定时计划</h2>
            <p className="text-sm text-muted-foreground mb-6">
              每个任务一行：内置任务（组卡提炼 / 复盘报告 / 补分类 / 分类整理）常驻可改不可删，也可新建自定义任务；按时间规则（每天时刻 / 间隔 / 时间窗口 / 单次）或条件事件（启动、关会话、窗口关闭）触发，多个触发器任一命中即触发。
            </p>
            <SchedulerPanel workspaceId={workspaceId} workspaces={workspaces} />
          </div>
        </TabsContent>

        <TabsContent value="parse-history" className="flex-1 overflow-y-auto mt-0 p-0 data-[state=inactive]:hidden">
          <div className="max-w-4xl py-6 px-6">
            <ParseHistoryPanel />
          </div>
        </TabsContent>

        <TabsContent value="memory" className="flex-1 overflow-y-auto mt-0 p-0 data-[state=inactive]:hidden">
          <div className="max-w-4xl py-6 px-6">
            <h2 className="text-lg font-semibold mb-1">记忆</h2>
            <MemorySection workspaceId={workspaceId} workspaces={workspaces} />
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
