import { useCallback, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardTitle } from '@/components/ui/card';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { client } from '@/lib/client';
import type { Workspace } from '@/types/electron-api';
import { formatBytes, formatTime, type WorkspaceGitSummary } from './backup-meta';

interface Props {
  workspaces: Workspace[];
}

export function GitSummarySection({ workspaces }: Props) {
  const [summaries, setSummaries] = useState<Record<string, WorkspaceGitSummary>>({});
  const [gitAvailable, setGitAvailable] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const cap = await client.getGitCapability();
      setGitAvailable(cap.available);
      if (!cap.available) {
        setSummaries({});
        return;
      }
      const results = await Promise.all(
        workspaces.map(async (w) => {
          const r = await client.getWorkspaceGitSummary({ workspaceId: w.id });
          return [w.id, 'userRepo' in r ? r : null] as const;
        }),
      );
      const next: Record<string, WorkspaceGitSummary> = {};
      for (const [id, s] of results) {
        if (s) next[id] = s;
      }
      setSummaries(next);
    } catch (e) {
      toast.error('加载版本状态失败', { description: String(e) });
    } finally {
      setLoading(false);
    }
  }, [workspaces]);

  useEffect(() => {
    load();
  }, [load]);

  const renderUserRepoRow = (w: Workspace) => {
    const s = summaries[w.id];
    return (
      <div key={w.id} className="flex items-center gap-2 text-sm min-w-0">
        <span className="w-28 shrink-0 truncate text-muted-foreground" title={w.name}>
          {w.name}
        </span>
        {gitAvailable === false ? (
          <span className="text-xs text-muted-foreground">未安装 git</span>
        ) : !s ? (
          <span className="text-xs text-muted-foreground">加载中…</span>
        ) : !s.userRepo.isRepo ? (
          <span className="text-xs text-muted-foreground">非 git 仓库</span>
        ) : (
          <>
            <Badge variant="outline" className="font-normal">
              {s.userRepo.branch ?? '无分支'}
            </Badge>
            <span className={cn('text-xs', s.userRepo.changedCount > 0 ? 'text-amber-600' : 'text-muted-foreground')}>
              {s.userRepo.changedCount > 0 ? `${s.userRepo.changedCount} 处未提交` : '工作区干净'}
            </span>
          </>
        )}
      </div>
    );
  };

  const renderShadowRow = (w: Workspace) => {
    const s = summaries[w.id];
    const body =
      gitAvailable === false ? (
        <span className="text-xs text-muted-foreground">未安装 git</span>
      ) : !s ? (
        <span className="text-xs text-muted-foreground">加载中…</span>
      ) : s.shadow.snapshotCount > 0 ? (
        <div className="min-w-0 flex-1">
          <div className="text-xs text-muted-foreground">
            {s.shadow.snapshotCount} 个快照 · {formatBytes(s.shadow.sizeBytes)}
          </div>
          <div className="text-xs text-muted-foreground/70 mt-0.5">最近 {formatTime(s.shadow.lastTime)}</div>
        </div>
      ) : (
        <span className="text-xs text-muted-foreground">暂无快照</span>
      );
    return (
      <div key={w.id} className="flex items-start gap-2 text-sm min-w-0">
        <span className="w-28 shrink-0 truncate text-muted-foreground pt-0.5" title={w.name}>
          {w.name}
        </span>
        {body}
      </div>
    );
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-muted-foreground">版本状态</h2>
        <Button variant="ghost" size="sm" onClick={() => load()} disabled={loading}>
          <RefreshCw className={cn('w-3.5 h-3.5', loading && 'animate-spin')} />
        </Button>
      </div>
      {workspaces.length === 0 ? (
        <Card className="py-4 px-4 text-sm text-muted-foreground">暂无工作区</Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card className="py-4 gap-3">
            <div className="px-4">
              <CardTitle className="text-sm">用户 Git 仓库</CardTitle>
              <p className="text-xs text-muted-foreground mt-1">工作区自身的 git 仓库；正式提交由 Agent 完成，此处只读查看分支与未提交改动</p>
            </div>
            <div className="px-4 space-y-2">{workspaces.map(renderUserRepoRow)}</div>
          </Card>
          <Card className="py-4 gap-3">
            <div className="px-4">
              <CardTitle className="text-sm">自动快照</CardTitle>
              <p className="text-xs text-muted-foreground mt-1">Agent 写入或文件树操作后自动保存的完整存档，在文件树右键「历史」中查看与恢复</p>
            </div>
            <div className="px-4 space-y-2">{workspaces.map(renderShadowRow)}</div>
          </Card>
        </div>
      )}
    </div>
  );
}
