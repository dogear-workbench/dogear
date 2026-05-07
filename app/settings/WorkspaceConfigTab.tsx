/**
 * 工作区配置 Tab（设置页）
 *
 * 里程碑 1.5 Step A2.6 后：仅展示当前工作区 `.claude` 目录只读状态。
 * CLAUDE.md 编辑器已迁出到顶部导航栏的 "工作区规则" Dialog（WorkspaceRuleDialog）。
 */

import { useState, useEffect, useCallback } from 'react';
import { FolderOpen, RefreshCw, FileText, Check, ExternalLink } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { client } from '@/lib/client';
import { useWorkspaceStore } from '@/stores/workspace-store';

interface ClaudeDirStatus {
  exists: boolean;
  hasClaudeMd: boolean;
  hasAgentsDir: boolean;
  agentFiles: string[];
}

interface WorkspaceConfigTabProps {
  // 保留 props 形态以兼容设置页调用处，当前不再使用 local/setLocal
  local?: unknown;
  setLocal?: unknown;
}

export function WorkspaceConfigTab(_props: WorkspaceConfigTabProps) {
  const workspace = useWorkspaceStore((s) => s.workspace);
  const workspacePath = workspace?.path;

  const [status, setStatus] = useState<ClaudeDirStatus | null>(null);
  const [loading, setLoading] = useState(false);

  const loadData = useCallback(async () => {
    if (!workspacePath) return;
    setLoading(true);
    try {
      const statusResult = await client.getClaudeDirStatus({ workspacePath });
      if ('status' in statusResult) {
        setStatus(statusResult.status as ClaudeDirStatus);
      }
    } finally {
      setLoading(false);
    }
  }, [workspacePath]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleInit = async () => {
    if (!workspacePath) return;
    await client.initClaudeDir({ workspacePath });
    await loadData();
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
    <div className="max-w-2xl py-6 px-6">
      <h2 className="text-lg font-semibold mb-1">工作区配置</h2>
      <p className="text-sm text-muted-foreground mb-6">
        查看当前工作区的 .claude 目录状态。
      </p>

      <div className="space-y-8">
        {/* .claude 目录状态（只读） */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium">.claude 目录</label>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={loadData}
              disabled={loading}
            >
              <RefreshCw className={cn('w-3.5 h-3.5', loading && 'animate-spin')} />
            </Button>
          </div>

          {status ? (
            <div className="rounded-md border p-3 space-y-2 text-sm">
              <div className="flex items-center gap-2">
                {status.exists ? (
                  <Check className="w-4 h-4 text-emerald-500" />
                ) : (
                  <div className="w-4 h-4 rounded-full border-2 border-muted-foreground/30" />
                )}
                <span className={status.exists ? '' : 'text-muted-foreground'}>
                  {workspacePath}/.claude/
                </span>
              </div>

              {status.exists && (
                <>
                  <div className="flex items-center gap-2 ml-6">
                    <FileText className="w-3.5 h-3.5 text-muted-foreground" />
                    <span className={status.hasClaudeMd ? '' : 'text-muted-foreground'}>
                      CLAUDE.md {status.hasClaudeMd ? '' : '（不存在）'}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 ml-6">
                    <FolderOpen className="w-3.5 h-3.5 text-muted-foreground" />
                    <span>
                      agents/{' '}
                      {status.hasAgentsDir ? `（${status.agentFiles.length} 个代理）` : '（不存在）'}
                    </span>
                  </div>
                </>
              )}

              {!status.exists && (
                <Button variant="outline" size="sm" onClick={handleInit}>
                  初始化 .claude 目录
                </Button>
              )}
            </div>
          ) : (
            <div className="text-sm text-muted-foreground">加载中...</div>
          )}
        </div>

        {/* CLAUDE.md 编辑入口迁移提示 */}
        <div className="rounded-md border border-dashed p-4 text-sm space-y-2">
          <div className="flex items-center gap-2 font-medium">
            <ExternalLink className="w-4 h-4" />
            CLAUDE.md 编辑器已迁移
          </div>
          <p className="text-muted-foreground text-xs leading-relaxed">
            关闭此设置页，点击顶部导航栏的 <span className="font-medium">「工作区规则」</span>{' '}
            按钮即可编辑当前工作区的 CLAUDE.md。
          </p>
        </div>
      </div>
    </div>
  );
}
