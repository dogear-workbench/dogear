import { useState } from 'react';
import { FolderOpen, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { client } from '@/lib/client';
import { useConfirmStore } from '@/stores/confirm-store';
import type { Workspace } from '@/types/electron-api';
import { CoreProfilePanel } from './core-profile-panel';
import { TopicsPanel } from './topics-panel';
import { SmartCategoryPanel } from './smart-category-panel';

interface Props {
  workspaceId: string | 'all';
  workspaces: Workspace[];
}

export function MemorySection({ workspaceId, workspaces }: Props) {
  const confirm = useConfirmStore((s) => s.confirm);
  const [rebuilding, setRebuilding] = useState(false);

  const workspace = workspaceId === 'all'
    ? undefined
    : workspaces.find((w) => w.id === workspaceId);
  const workspacePath = workspace?.path;

  const handleRebuildIndex = async () => {
    if (!workspacePath) return;
    setRebuilding(true);
    try {
      const result = await client.rebuildMemoryIndex({ workspacePath });
      const err = 'error' in result ? result.error : undefined;
      if (err) {
        await confirm({
          title: '重建索引失败',
          description: err,
          buttons: [{ label: '知道了', value: 'ok' }],
        });
        return;
      }
      const index = 'index' in result ? result.index : undefined;
      const consistency = 'consistency' in result ? result.consistency : undefined;
      if (!index || !consistency) return;

      const lines: string[] = [
        `已扫描 topics/ 目录，索引包含 ${index.topics.length} 个主题。`,
      ];
      if (consistency.orphansOnDisk.length > 0) {
        lines.push(`新纳入索引的文件:${consistency.orphansOnDisk.join(', ')}`);
      }
      if (consistency.orphansInIndex.length > 0) {
        lines.push(`⚠ 索引中有 ${consistency.orphansInIndex.length} 个条目找不到对应文件(已保留索引,可手动清理):${consistency.orphansInIndex.join(', ')}`);
      }
      if (consistency.orphansOnDisk.length === 0 && consistency.orphansInIndex.length === 0) {
        lines.push('✓ 索引与文件完全一致');
      }
      await confirm({
        title: '重建索引完成',
        description: lines.join('\n'),
        buttons: [{ label: '知道了', value: 'ok' }],
      });
    } finally {
      setRebuilding(false);
    }
  };

  if (!workspace || !workspacePath) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground">
        <div className="text-center space-y-2">
          <FolderOpen className="w-10 h-10 mx-auto opacity-50" />
          <p className="text-sm">记忆按工作区组织，请在右上角选择具体工作区</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          为「{workspace.name}」维护核心档案与主题记忆。核心档案每次会话启动时注入系统提示词，
          主题记忆通过 Agent 的 dogear__RecallMemory 工具按关键词检索。
        </p>
        <Button variant="outline" size="sm" onClick={handleRebuildIndex} disabled={rebuilding}>
          <RefreshCw className={rebuilding ? 'w-4 h-4 mr-1 animate-spin' : 'w-4 h-4 mr-1'} />
          {rebuilding ? '重建中...' : '重建索引'}
        </Button>
      </div>

      <Tabs defaultValue="core">
        <TabsList>
          <TabsTrigger value="core">核心档案</TabsTrigger>
          <TabsTrigger value="topics">主题记忆</TabsTrigger>
          <TabsTrigger value="smart-category">智能分类</TabsTrigger>
        </TabsList>

        <TabsContent value="core" className="pt-4">
          <CoreProfilePanel workspacePath={workspacePath} />
        </TabsContent>

        <TabsContent value="topics" className="pt-4">
          <TopicsPanel workspacePath={workspacePath} />
        </TabsContent>

        <TabsContent value="smart-category" className="pt-4">
          <SmartCategoryPanel workspaceId={workspace.id} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
