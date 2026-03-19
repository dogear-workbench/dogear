import { useState, useEffect, useCallback } from 'react';
import { FolderOpen, RefreshCw, FileText, Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { client } from '@/lib/client';
import { useWorkspaceStore } from '@/stores/workspace-store';
import type { AppSettings } from '@/types/settings';

interface ClaudeDirStatus {
  exists: boolean;
  hasClaudeMd: boolean;
  hasAgentsDir: boolean;
  agentFiles: string[];
}

interface WorkspaceConfigTabProps {
  local: AppSettings;
  setLocal: (updater: (prev: AppSettings) => AppSettings) => void;
}

export function WorkspaceConfigTab({ local, setLocal }: WorkspaceConfigTabProps) {
  const workspace = useWorkspaceStore((s) => s.workspace);
  const workspacePath = workspace?.path;

  const [status, setStatus] = useState<ClaudeDirStatus | null>(null);
  const [claudeMdContent, setClaudeMdContent] = useState('');
  const [savedClaudeMdContent, setSavedClaudeMdContent] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  // 加载 .claude 目录状态和 CLAUDE.md 内容
  const loadData = useCallback(async () => {
    if (!workspacePath) return;
    setLoading(true);
    try {
      const [statusResult, mdResult] = await Promise.all([
        client.getClaudeDirStatus({ workspacePath }),
        client.readClaudeMd({ workspacePath }),
      ]);
      if ('status' in statusResult) {
        setStatus(statusResult.status as ClaudeDirStatus);
      }
      const content = ('content' in mdResult ? mdResult.content : null) as string | null;
      setClaudeMdContent(content || '');
      setSavedClaudeMdContent(content || '');
    } finally {
      setLoading(false);
    }
  }, [workspacePath]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // 初始化 .claude 目录
  const handleInit = async () => {
    if (!workspacePath) return;
    await client.initClaudeDir({ workspacePath });
    await loadData();
  };

  // 保存 CLAUDE.md
  const handleSaveClaudeMd = async () => {
    if (!workspacePath) return;
    setSaving(true);
    try {
      await client.writeClaudeMd({ workspacePath, content: claudeMdContent });
      setSavedClaudeMdContent(claudeMdContent);
    } finally {
      setSaving(false);
    }
  };

  const claudeMdDirty = claudeMdContent !== savedClaudeMdContent;

  // settingSources 控制
  const sources = local.ai.settingSources || ['user'];
  const toggleSource = (source: 'user' | 'project') => {
    setLocal((prev) => {
      const current = prev.ai.settingSources || ['user'];
      const has = current.includes(source);
      const next = has ? current.filter((s) => s !== source) : [...current, source];
      // 至少保留一个
      if (next.length === 0) return prev;
      return { ...prev, ai: { ...prev.ai, settingSources: next } };
    });
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
        管理工作区的 .claude 目录和 SDK 设置源
      </p>

      <div className="space-y-8">
        {/* settingSources 控制 */}
        <div className="space-y-3">
          <label className="text-sm font-medium">设置源（settingSources）</label>
          <p className="text-xs text-muted-foreground">
            控制 Agent SDK 加载哪些级别的配置文件。启用 project 后会自动加载工作区 .claude/CLAUDE.md。
          </p>
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Checkbox
                id="source-user"
                checked={sources.includes('user')}
                onCheckedChange={() => toggleSource('user')}
              />
              <label htmlFor="source-user" className="text-sm">
                user — 加载用户级 ~/.claude/ 配置
              </label>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="source-project"
                checked={sources.includes('project')}
                onCheckedChange={() => toggleSource('project')}
              />
              <label htmlFor="source-project" className="text-sm">
                project — 加载工作区 .claude/ 配置（CLAUDE.md、agents/）
              </label>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            修改后需保存设置并重启会话才能生效。
          </p>
        </div>

        {/* .claude 目录状态 */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium">.claude 目录</label>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={loadData} disabled={loading}>
              <RefreshCw className={cn("w-3.5 h-3.5", loading && "animate-spin")} />
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
                      agents/ {status.hasAgentsDir ? `（${status.agentFiles.length} 个代理）` : '（不存在）'}
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

        {/* CLAUDE.md 编辑器 */}
        {status?.exists && (
          <div className="space-y-3">
            <label className="text-sm font-medium">CLAUDE.md 工作区指令</label>
            <p className="text-xs text-muted-foreground">
              此文件的内容会被 Agent SDK 自动加载为项目级指令（需启用 project 设置源）。
            </p>
            <Textarea
              value={claudeMdContent}
              onChange={(e) => setClaudeMdContent(e.target.value)}
              placeholder="# 工作区指令&#10;&#10;在此编写给 AI 助手的工作区级别指令..."
              className="min-h-[200px] font-mono text-sm resize-y"
            />
            <div className="flex justify-end">
              <Button
                size="sm"
                onClick={handleSaveClaudeMd}
                disabled={!claudeMdDirty || saving}
              >
                {saving ? '保存中...' : '保存 CLAUDE.md'}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
