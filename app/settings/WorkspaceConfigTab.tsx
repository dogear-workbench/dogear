/**
 * 工作区配置 Tab（设置页）
 *
 * 展示当前工作区 agent.md 状态。
 * 工作区级 agent.md 编辑器在顶部导航栏的 "工作区规则" Dialog（WorkspaceRuleDialog）。
 * 用户级 agent.md 编辑器在「基础设置」Tab 的 GeneralAgentMdDialog。
 */

import { useState, useEffect, useCallback } from 'react';
import { RefreshCw, FileText, Check, ExternalLink } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { client } from '@/lib/client';
import { useWorkspaceStore } from '@/stores/workspace-store';

interface AgentMdStatus {
  hasWorkspaceAgentMd: boolean;
  hasUserAgentMd: boolean;
}

interface WorkspaceConfigTabProps {
  local?: unknown;
  setLocal?: unknown;
}

export function WorkspaceConfigTab(_props: WorkspaceConfigTabProps) {
  const workspace = useWorkspaceStore((s) => s.workspace);

  const [status, setStatus] = useState<AgentMdStatus | null>(null);
  const [loading, setLoading] = useState(false);

  const loadData = useCallback(async () => {
    if (!workspace) return;
    setLoading(true);
    try {
      const statusResult = await client.getAgentMdStatus({ workspaceId: workspace.id });
      if ('status' in statusResult) {
        setStatus(statusResult.status as AgentMdStatus);
      }
    } finally {
      setLoading(false);
    }
  }, [workspace]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleInit = async () => {
    if (!workspace) return;
    await client.initAgentMd({ workspaceId: workspace.id });
    await loadData();
  };

  if (!workspace) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground">
        <div className="text-center space-y-2">
          <FileText className="w-10 h-10 mx-auto opacity-50" />
          <p className="text-sm">请先选择一个工作区</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl py-6 px-6">
      <h2 className="text-lg font-semibold mb-1">工作区配置</h2>
      <p className="text-sm text-muted-foreground mb-6">
        查看当前工作区的 agent.md 状态。
      </p>

      <div className="space-y-8">
        {/* agent.md 状态（只读） */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium">agent.md 状态</label>
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
                {status.hasWorkspaceAgentMd ? (
                  <Check className="w-4 h-4 text-emerald-500" />
                ) : (
                  <div className="w-4 h-4 rounded-full border-2 border-muted-foreground/30" />
                )}
                <span className={status.hasWorkspaceAgentMd ? '' : 'text-muted-foreground'}>
                  工作区 agent.md {status.hasWorkspaceAgentMd ? '' : '（不存在）'}
                </span>
              </div>

              <div className="flex items-center gap-2 ml-6">
                <FileText className="w-3.5 h-3.5 text-muted-foreground" />
                <span className={status.hasUserAgentMd ? '' : 'text-muted-foreground'}>
                  用户级 agent.md {status.hasUserAgentMd ? '' : '（不存在）'}
                </span>
              </div>

              {!status.hasWorkspaceAgentMd && (
                <Button variant="outline" size="sm" onClick={handleInit}>
                  初始化工作区 agent.md
                </Button>
              )}
            </div>
          ) : (
            <div className="text-sm text-muted-foreground">加载中...</div>
          )}
        </div>

        {/* 编辑入口指引 */}
        <div className="rounded-md border border-dashed p-4 text-sm space-y-2">
          <div className="flex items-center gap-2 font-medium">
            <ExternalLink className="w-4 h-4" />
            agent.md 编辑入口
          </div>
          <p className="text-muted-foreground text-xs leading-relaxed">
            工作区级 agent.md：关闭此设置页，点击顶部导航栏的{' '}
            <span className="font-medium">「工作区规则」</span> 按钮编辑。
          </p>
          <p className="text-muted-foreground text-xs leading-relaxed">
            用户级 agent.md：前往 <span className="font-medium">「基础设置」</span> Tab 编辑。
          </p>
        </div>
      </div>
    </div>
  );
}
