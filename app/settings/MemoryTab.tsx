import { useState } from 'react';
import { FolderOpen, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { client } from '@/lib/client';
import { useWorkspaceStore } from '@/stores/workspace-store';
import { useConfirmStore } from '@/stores/confirm-store';
import { CoreProfilePanel } from './memory/CoreProfilePanel';
import { TopicsPanel } from './memory/TopicsPanel';
import { DigestsPanel } from './memory/DigestsPanel';

export function MemoryTab() {
  const workspace = useWorkspaceStore((s) => s.workspace);
  const workspacePath = workspace?.path;
  const workspaceId = workspace?.id;
  const confirm = useConfirmStore((s) => s.confirm);
  const [rebuilding, setRebuilding] = useState(false);

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

  if (!workspacePath) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground">
        <div className="text-center space-y-2">
          <FolderOpen className="w-10 h-10 mx-auto opacity-50" />
          <p className="text-sm">请先选择一个工作区</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl py-6 px-6">
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-lg font-semibold">记忆管理</h2>
        <Button variant="outline" size="sm" onClick={handleRebuildIndex} disabled={rebuilding}>
          <RefreshCw className={rebuilding ? 'w-4 h-4 mr-1 animate-spin' : 'w-4 h-4 mr-1'} />
          {rebuilding ? '重建中...' : '重建索引'}
        </Button>
      </div>
      <p className="text-sm text-muted-foreground mb-6">
        为当前工作区维护核心档案和主题记忆。核心档案每次会话启动时注入系统提示词，
        主题记忆通过 Agent 的 RecallMemory 工具按关键词检索。
      </p>

      <Tabs defaultValue="core">
        <TabsList>
          <TabsTrigger value="core">核心档案</TabsTrigger>
          <TabsTrigger value="topics">主题记忆</TabsTrigger>
          <TabsTrigger value="digests">会话摘要</TabsTrigger>
        </TabsList>

        <TabsContent value="core" className="pt-4">
          <CoreProfilePanel workspacePath={workspacePath} />
        </TabsContent>

        <TabsContent value="topics" className="pt-4">
          <TopicsPanel workspacePath={workspacePath} />
        </TabsContent>

        <TabsContent value="digests" className="pt-4">
          {workspaceId && <DigestsPanel workspaceId={workspaceId} workspacePath={workspacePath} />}
        </TabsContent>
      </Tabs>
    </div>
  );
}
