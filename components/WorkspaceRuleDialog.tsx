/**
 * 工作区规则 Dialog（里程碑 1.5 Step A2.6）
 *
 * 职责：
 * - 编辑当前工作区的 `.claude/CLAUDE.md`（项目级规则）
 * - 展示 .claude 目录状态（存在性、CLAUDE.md/agents 存在）
 * - 未初始化时提供一键初始化按钮
 * - dirty 检测 + 关闭时未保存提示
 *
 * 不负责：
 * - 用户级（全局）CLAUDE.md —— 见设置页 AI 行为 Tab
 * - 工作区删除/恢复/环境检查 —— 见设置页工作区管理 Tab（A2.7）
 */

import { useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import { FolderOpen, RefreshCw, FileText, Check, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { client } from '@/lib/client';
import { showConfirm } from '@/stores/confirm-store';
import { useWorkspaceStore } from '@/stores/workspace-store';

interface ClaudeDirStatus {
  exists: boolean;
  hasClaudeMd: boolean;
  hasAgentsDir: boolean;
  agentFiles: string[];
}

interface WorkspaceRuleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function WorkspaceRuleDialog({ open, onOpenChange }: WorkspaceRuleDialogProps) {
  const workspace = useWorkspaceStore((s) => s.workspace);
  const workspacePath = workspace?.path;

  const [status, setStatus] = useState<ClaudeDirStatus | null>(null);
  const [content, setContent] = useState('');
  const [savedContent, setSavedContent] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [initing, setIniting] = useState(false);

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
      const md = ('content' in mdResult ? mdResult.content : null) as string | null;
      setContent(md || '');
      setSavedContent(md || '');
    } catch (err) {
      console.error('加载工作区规则失败:', err);
      toast.error('加载失败', {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setLoading(false);
    }
  }, [workspacePath]);

  // Dialog 打开时拉取最新数据（关闭后状态保留但下次打开重新加载，避免编辑过时内容）
  useEffect(() => {
    if (open) loadData();
  }, [open, loadData]);

  const dirty = content !== savedContent;

  const handleInit = async () => {
    if (!workspacePath) return;
    setIniting(true);
    try {
      await client.initClaudeDir({ workspacePath });
      await loadData();
      toast.success('.claude 目录已初始化');
    } catch (err) {
      console.error('初始化失败:', err);
      toast.error('初始化失败', {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setIniting(false);
    }
  };

  const handleSave = async () => {
    if (!workspacePath) return;
    setSaving(true);
    try {
      await client.writeClaudeMd({ workspacePath, content });
      setSavedContent(content);
      toast.success('已保存 CLAUDE.md');
    } catch (err) {
      console.error('保存失败:', err);
      toast.error('保存失败', {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setSaving(false);
    }
  };

  // dirty 关闭拦截：强制关闭时提示丢弃改动
  const handleOpenChange = async (next: boolean) => {
    if (!next && dirty) {
      const ok = await showConfirm(
        '放弃未保存的修改？',
        '你对 CLAUDE.md 的改动还没保存，关闭将丢弃这些修改。',
      );
      if (!ok) return;
      // 放弃：回滚到已保存内容
      setContent(savedContent);
    }
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>工作区规则</DialogTitle>
          <DialogDescription>
            编辑当前工作区 <span className="font-medium">「{workspace?.name ?? '未选择'}」</span>{' '}
            的 <code className="text-xs bg-muted px-1 py-0.5 rounded">.claude/CLAUDE.md</code>。
            Agent SDK 会把此文件自动加载为项目级指令。
          </DialogDescription>
        </DialogHeader>

        {!workspacePath ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            请先选择一个工作区
          </div>
        ) : (
          <div className="space-y-4">
            {/* .claude 目录状态 */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-muted-foreground">
                  .claude 目录
                </label>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={loadData}
                  disabled={loading}
                  title="重新加载"
                >
                  <RefreshCw className={cn('w-3 h-3', loading && 'animate-spin')} />
                </Button>
              </div>

              {status ? (
                <div className="rounded-md border p-3 space-y-1.5 text-xs">
                  <div className="flex items-center gap-2">
                    {status.exists ? (
                      <Check className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                    ) : (
                      <div className="w-3.5 h-3.5 rounded-full border border-muted-foreground/40 shrink-0" />
                    )}
                    <span
                      className={cn('truncate', !status.exists && 'text-muted-foreground')}
                      title={`${workspacePath}/.claude/`}
                    >
                      {workspacePath}/.claude/
                    </span>
                  </div>

                  {status.exists ? (
                    <>
                      <div className="flex items-center gap-2 ml-5 text-muted-foreground">
                        <FileText className="w-3 h-3" />
                        <span>
                          CLAUDE.md{status.hasClaudeMd ? '' : '（尚未创建）'}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 ml-5 text-muted-foreground">
                        <FolderOpen className="w-3 h-3" />
                        <span>
                          agents/{' '}
                          {status.hasAgentsDir
                            ? `（${status.agentFiles.length} 个代理）`
                            : '（不存在）'}
                        </span>
                      </div>
                    </>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      className="mt-1"
                      onClick={handleInit}
                      disabled={initing}
                    >
                      {initing && <Loader2 className="w-3 h-3 animate-spin mr-1" />}
                      初始化 .claude 目录
                    </Button>
                  )}
                </div>
              ) : (
                <div className="rounded-md border p-3 text-xs text-muted-foreground">
                  加载中...
                </div>
              )}
            </div>

            {/* CLAUDE.md 编辑器 */}
            {status?.exists && (
              <div className="space-y-2">
                <label className="text-xs font-medium text-muted-foreground">
                  CLAUDE.md 内容
                  {dirty && (
                    <span className="ml-2 text-amber-600">● 未保存</span>
                  )}
                </label>
                <Textarea
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  placeholder={'# 工作区指令\n\n在此编写给 AI 助手的工作区级指令...'}
                  className="min-h-[280px] max-h-[50vh] font-mono text-xs resize-y"
                />
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
            关闭
          </Button>
          {status?.exists && (
            <Button onClick={handleSave} disabled={!dirty || saving}>
              {saving && <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" />}
              {saving ? '保存中...' : '保存'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
