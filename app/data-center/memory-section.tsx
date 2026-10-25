import { useEffect, useState } from 'react';
import { FolderOpen, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { client } from '@/lib/client';
import { useConfirmStore } from '@/stores/confirm-store';
import type { Workspace } from '@/types/electron-api';
import type { MemoryScope } from './memory-types';
import { useDataCenterFocusStore, type MemoryTopicFocusReq } from './memory-focus';
import { TopicsPanel } from './topics-panel';
import { LearnedAssetsSection } from './learned-assets-section';

interface Props {
  workspaces: Workspace[];
}

const GLOBAL_ID = 'global';

export function MemorySection({ workspaces }: Props) {
  const confirm = useConfirmStore((s) => s.confirm);
  const [rebuilding, setRebuilding] = useState(false);
  const [workspaceId, setWorkspaceId] = useState<string>('all');
  const memoryTopicReq = useDataCenterFocusStore((s) => s.memoryTopicReq);
  const [topicFocus, setTopicFocus] = useState<MemoryTopicFocusReq | null>(null);

  // 顶栏记忆搜索命中：切到请求的工作区范围并展开选中请求的主题，随后消费掉请求
  useEffect(() => {
    if (!memoryTopicReq) return;
    setWorkspaceId(memoryTopicReq.workspaceId);
    setTopicFocus(memoryTopicReq);
    useDataCenterFocusStore.getState().consumeMemoryTopic();
  }, [memoryTopicReq]);

  const isGlobal = workspaceId === GLOBAL_ID;
  const scope: MemoryScope = isGlobal ? 'global' : 'workspace';
  const workspace = workspaceId === 'all' || isGlobal
    ? undefined
    : workspaces.find((w) => w.id === workspaceId);
  const activeWorkspaceId = isGlobal ? GLOBAL_ID : workspace?.id;

  const handleRebuildIndex = async () => {
    if (!activeWorkspaceId) return;
    setRebuilding(true);
    try {
      const result = await client.rebuildMemoryIndex({ workspaceId: activeWorkspaceId, scope });
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

  const header = (
    <div className="flex items-center justify-end gap-4">
      <Select value={workspaceId} onValueChange={setWorkspaceId}>
        <SelectTrigger size="sm" className="w-[180px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">全部工作区</SelectItem>
          <SelectItem value={GLOBAL_ID}>全局（跨工作区共享）</SelectItem>
          {workspaces.map((w) => (
            <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );

  if (!activeWorkspaceId) {
    return (
      <div className="mx-auto max-w-4xl px-6 py-6">
        {header}
        <div className="flex items-center justify-center text-muted-foreground py-16">
          <div className="text-center space-y-2">
            <FolderOpen className="w-10 h-10 mx-auto opacity-50" />
            <p className="text-sm">记忆按工作区组织，请在上方选择具体工作区，或选「全局」查看跨工作区共享的记忆</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl px-6 py-6">
      {header}
      <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {isGlobal
            ? '维护跨工作区共享的全局记忆（scope=global），所有工作区的 Agent 会话都能检索到这些主题。'
            : `为「${workspace?.name}」维护主题记忆。主题记忆通过 Agent 的 dogear__RecallMemory 工具按关键词检索，跨会话沉淀稳定知识。`}
        </p>
        <Button variant="outline" size="sm" onClick={handleRebuildIndex} disabled={rebuilding}>
          <RefreshCw className={rebuilding ? 'w-4 h-4 mr-1 animate-spin' : 'w-4 h-4 mr-1'} />
          {rebuilding ? '重建中...' : '重建索引'}
        </Button>
      </div>

      <TopicsPanel workspaceId={activeWorkspaceId} scope={scope} focusReq={topicFocus} />

      <LearnedAssetsSection />
      </div>
    </div>
  );
}
