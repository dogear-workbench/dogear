/**
 * 工作区规则 Dialog
 *
 * 编辑当前工作区的 agent.md（.dogear/workspaces/{id}/agent.md）。
 * dirty 检测 + 关闭时未保存提示。
 */

import { useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import { Loader2, Pencil, Eye, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { MarkdownRenderer } from '@/components/MarkdownRenderer';
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

interface WorkspaceRuleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function WorkspaceRuleDialog({ open, onOpenChange }: WorkspaceRuleDialogProps) {
  const workspace = useWorkspaceStore((s) => s.workspace);

  const [content, setContent] = useState('');
  const [savedContent, setSavedContent] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [isEditing, setIsEditing] = useState(false);

  const loadData = useCallback(async () => {
    if (!workspace) return;
    setLoading(true);
    try {
      const mdResult = await client.readWorkspaceAgentMd({ workspaceId: workspace.id });
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
  }, [workspace]);

  // Dialog 打开时拉取最新数据（关闭后状态保留但下次打开重新加载，避免编辑过时内容）
  useEffect(() => {
    if (open) {
      loadData();
      setIsEditing(false);
    }
  }, [open, loadData]);

  const dirty = content !== savedContent;

  const handleSave = async () => {
    if (!workspace) return;
    setSaving(true);
    try {
      await client.writeWorkspaceAgentMd({ workspaceId: workspace.id, content });
      setSavedContent(content);
      setIsEditing(false);
      toast.success('已保存 agent.md');
    } catch (err) {
      console.error('保存失败:', err);
      toast.error('保存失败', {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setSaving(false);
    }
  };

  const handleRestoreTemplate = async () => {
    const ok = await showConfirm(
      '恢复为模板？',
      '当前编辑区内容将被替换为模板内容，你需要手动保存才会生效。',
    );
    if (!ok) return;
    try {
      const res = await client.getWorkspaceAgentTemplate();
      const tpl = ('content' in res ? res.content : '') as string;
      setContent(tpl);
      setIsEditing(true);
    } catch (err) {
      toast.error('加载模板失败', {
        description: err instanceof Error ? err.message : String(err),
      });
    }
  };

  const handleCancelEdit = async () => {
    if (dirty) {
      const ok = await showConfirm(
        '放弃未保存的修改？',
        '你对 agent.md 的改动还没保存。',
      );
      if (!ok) return;
      setContent(savedContent);
    }
    setIsEditing(false);
  };

  // dirty 关闭拦截：强制关闭时提示丢弃改动
  const handleOpenChange = async (next: boolean) => {
    if (!next && dirty) {
      const ok = await showConfirm(
        '放弃未保存的修改？',
        '你对 agent.md 的改动还没保存，关闭将丢弃这些修改。',
      );
      if (!ok) return;
      // 放弃：回滚到已保存内容
      setContent(savedContent);
    }
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-6xl">
        <DialogHeader>
          <DialogTitle>工作区规则</DialogTitle>
          <DialogDescription>
            编辑当前工作区 <span className="font-medium">「{workspace?.name ?? '未选择'}」</span>{' '}
            的 <code className="text-xs bg-muted px-1 py-0.5 rounded">.dogear/workspaces/{workspace?.id ?? '{id}'}/agent.md</code>。
            会话启动时会自动加载为项目级指令。
          </DialogDescription>
        </DialogHeader>

        {!workspace ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            请先选择一个工作区
          </div>
        ) : (
          <div className="space-y-4">
            {/* agent.md 编辑器 */}
            <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium text-muted-foreground">
                    agent.md 内容
                    {dirty && (
                      <span className="ml-2 text-amber-600">● 未保存</span>
                    )}
                  </label>
                  {!isEditing && (
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 px-2 text-xs"
                        onClick={handleRestoreTemplate}
                      >
                        <RotateCcw className="w-3 h-3 mr-1" />
                        恢复模板
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 px-2 text-xs"
                        onClick={() => setIsEditing(true)}
                      >
                        <Pencil className="w-3 h-3 mr-1" />
                        编辑
                      </Button>
                    </div>
                  )}
                  {isEditing && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 px-2 text-xs"
                      onClick={handleCancelEdit}
                    >
                      <Eye className="w-3 h-3 mr-1" />
                      返回预览
                    </Button>
                  )}
                </div>
                {isEditing ? (
                  <Textarea
                    value={content}
                    onChange={(e) => setContent(e.target.value)}
                    placeholder={'# 工作区指令\n\n在此编写给 AI 助手的工作区级指令...'}
                    className="min-h-[280px] max-h-[50vh] font-mono text-xs resize-y"
                  />
                ) : (
                  <div className="min-h-[280px] max-h-[50vh] overflow-y-auto rounded-md border bg-muted/10 px-3 py-2">
                    {content.trim() ? (
                      <MarkdownRenderer content={content} />
                    ) : (
                      <div className="text-xs text-muted-foreground py-2">
                        agent.md 为空，点击「编辑」开始填写。
                      </div>
                    )}
                  </div>
                )}
              </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
            关闭
          </Button>
          {isEditing && (
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
