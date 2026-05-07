/**
 * 首次启动引导卡片（里程碑 1.5 Step A2.4）
 *
 * 当用户完全没有工作区时显示（workspaces.json 为空或不存在）。
 * - 居中大卡片
 * - 一个主按钮：选择文件夹 → 创建默认工作区 → 进入主界面
 * - 不提供 "跳过"，工作区是必选前置
 */

import { useState } from 'react';
import { toast } from 'sonner';
import { FolderOpen, Loader2, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { client } from '@/lib/client';
import { useWorkspaceStore } from '@/stores/workspace-store';

export function WelcomeFirstRun() {
  const setWorkspace = useWorkspaceStore((s) => s.setWorkspace);
  const [creating, setCreating] = useState(false);

  const handleCreate = async () => {
    setCreating(true);
    try {
      const result = await client.selectFolder();
      if (result.canceled || !result.workspace) return;

      const folderPath = result.workspace.path;
      if (/[一-龥_]/.test(folderPath)) {
        toast.warning('路径包含不支持的字符', {
          description: '工作区路径不能包含中文或下划线（_），请选择其他文件夹',
          duration: 6000,
        });
        return;
      }

      await setWorkspace(result.workspace);
      toast.success(`欢迎！已创建工作区「${result.workspace.name}」`);
    } catch (err) {
      console.error('创建首个工作区失败:', err);
      toast.error('创建工作区失败', {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="h-screen flex items-center justify-center bg-muted/20 p-8">
      <div className="max-w-lg w-full bg-background rounded-xl border shadow-lg p-8 space-y-6">
        <div className="flex items-center justify-center w-16 h-16 mx-auto rounded-full bg-primary/10">
          <Sparkles className="w-8 h-8 text-primary" />
        </div>

        <div className="text-center space-y-2">
          <h1 className="text-2xl font-semibold">欢迎使用 Dogear</h1>
          <p className="text-sm text-muted-foreground">
            AI 驱动的阅读助手 —— 书籍 / 文章 / 股票分析，随手收藏
          </p>
        </div>

        <div className="rounded-lg bg-muted/50 p-4 space-y-2 text-sm">
          <p className="font-medium">先选一个文件夹作为你的第一个工作区</p>
          <p className="text-muted-foreground text-xs leading-relaxed">
            工作区是 Dogear 存放书籍、文章、对话历史的地方。建议选择一个空文件夹，
            也可以选择已有的书籍文件夹。
            <br />
            <span className="text-amber-600">
              注意：路径不要包含中文或下划线（_），否则会话历史可能错位。
            </span>
          </p>
        </div>

        <Button
          size="lg"
          className="w-full gap-2"
          onClick={handleCreate}
          disabled={creating}
        >
          {creating ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <FolderOpen className="w-4 h-4" />
          )}
          {creating ? '创建中...' : '选择文件夹并开始'}
        </Button>
      </div>
    </div>
  );
}
