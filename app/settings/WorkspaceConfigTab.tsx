/**
 * 工作区配置 Tab（设置页）
 *
 * 里程碑 1.5 Step A2.6 后：仅展示当前工作区 `.claude` 目录只读状态。
 * CLAUDE.md 编辑器已迁出到顶部导航栏的 "工作区规则" Dialog（WorkspaceRuleDialog）。
 */

import { useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import { FolderOpen, RefreshCw, FileText, Check, ExternalLink, Pencil, Eye, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { client } from '@/lib/client';
import { showConfirm } from '@/stores/confirm-store';
import { useWorkspaceStore } from '@/stores/workspace-store';
import { MarkdownRenderer } from '@/components/MarkdownRenderer';

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

  // 用户级 CLAUDE.md 编辑状态
  const [userContent, setUserContent] = useState('');
  const [userSavedContent, setUserSavedContent] = useState('');
  const [userLoading, setUserLoading] = useState(false);
  const [userSaving, setUserSaving] = useState(false);
  const [userEditing, setUserEditing] = useState(false);
  const userDirty = userContent !== userSavedContent;

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

  const loadUserContent = useCallback(async () => {
    setUserLoading(true);
    try {
      const res = await client.readUserClaudeMd();
      const md = ('content' in res ? res.content : null) as string | null;
      setUserContent(md || '');
      setUserSavedContent(md || '');
    } catch (err) {
      console.error('加载用户级 CLAUDE.md 失败:', err);
    } finally {
      setUserLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
    loadUserContent();
  }, [loadData, loadUserContent]);

  const handleInit = async () => {
    if (!workspacePath) return;
    await client.initClaudeDir({ workspacePath });
    await loadData();
  };

  const handleUserSave = async () => {
    setUserSaving(true);
    try {
      await client.writeUserClaudeMd({ content: userContent });
      setUserSavedContent(userContent);
      setUserEditing(false);
      toast.success('已保存用户级 CLAUDE.md');
    } catch (err) {
      toast.error('保存失败', {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setUserSaving(false);
    }
  };

  const handleUserCancelEdit = async () => {
    if (userDirty) {
      const ok = await showConfirm('放弃未保存的修改？', '你对用户级 CLAUDE.md 的改动还没保存。');
      if (!ok) return;
      setUserContent(userSavedContent);
    }
    setUserEditing(false);
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

        {/* 工作区 CLAUDE.md 编辑入口迁移提示 */}
        <div className="rounded-md border border-dashed p-4 text-sm space-y-2">
          <div className="flex items-center gap-2 font-medium">
            <ExternalLink className="w-4 h-4" />
            工作区 CLAUDE.md 编辑器
          </div>
          <p className="text-muted-foreground text-xs leading-relaxed">
            关闭此设置页，点击顶部导航栏的 <span className="font-medium">「工作区规则」</span>{' '}
            按钮即可编辑当前工作区的 CLAUDE.md。
          </p>
        </div>

        {/* 用户级 CLAUDE.md 编辑器 */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <label className="text-sm font-medium block">用户级 CLAUDE.md</label>
              <p className="text-xs text-muted-foreground mt-0.5">
                位于 <code className="text-[10px] bg-muted px-1 py-0.5 rounded">~/.claude/CLAUDE.md</code>，
                对所有工作区生效。
                {userDirty && (
                  <span className="ml-2 text-amber-600">● 未保存</span>
                )}
              </p>
            </div>
            <div className="flex items-center gap-1">
              {!userEditing && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={() => setUserEditing(true)}
                  disabled={userLoading}
                >
                  <Pencil className="w-3 h-3 mr-1" />
                  编辑
                </Button>
              )}
              {userEditing && (
                <>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs"
                    onClick={handleUserCancelEdit}
                  >
                    <Eye className="w-3 h-3 mr-1" />
                    返回预览
                  </Button>
                  <Button
                    size="sm"
                    className="h-7 px-2 text-xs"
                    onClick={handleUserSave}
                    disabled={!userDirty || userSaving}
                  >
                    {userSaving && <Loader2 className="w-3 h-3 animate-spin mr-1" />}
                    保存
                  </Button>
                </>
              )}
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={loadUserContent}
                disabled={userLoading}
                title="重新加载"
              >
                <RefreshCw className={cn('w-3.5 h-3.5', userLoading && 'animate-spin')} />
              </Button>
            </div>
          </div>

          {userEditing ? (
            <Textarea
              value={userContent}
              onChange={(e) => setUserContent(e.target.value)}
              placeholder={'# 全局指令\n\n在此编写对所有工作区生效的全局指令...'}
              className="min-h-[240px] max-h-[50vh] font-mono text-xs resize-y"
            />
          ) : (
            <div className="min-h-[240px] max-h-[50vh] overflow-y-auto rounded-md border bg-muted/10 px-3 py-2">
              {userLoading ? (
                <div className="text-xs text-muted-foreground py-2">加载中...</div>
              ) : userContent.trim() ? (
                <MarkdownRenderer content={userContent} />
              ) : (
                <div className="text-xs text-muted-foreground py-2">
                  用户级 CLAUDE.md 为空，点击「编辑」开始填写。
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
