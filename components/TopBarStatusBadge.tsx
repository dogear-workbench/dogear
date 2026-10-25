import { useEffect, type CSSProperties } from 'react';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useTaskStore } from '@/stores/task-store';
import { useSettingsStore } from '@/stores/settings-store';
import { useWorkspaceStore } from '@/stores/workspace-store';

export function TopBarStatusBadge() {
  const workspace = useWorkspaceStore((s) => s.workspace);
  const groups = useTaskStore((s) => s.groups);
  const loadedWorkspacePath = useTaskStore((s) => s.loadedWorkspacePath);
  const loadTasks = useTaskStore((s) => s.loadTasks);
  const subscribeTasksChanged = useTaskStore((s) => s.subscribeTasksChanged);
  const settings = useSettingsStore((s) => s.settings);
  const saveSettings = useSettingsStore((s) => s.saveSettings);

  useEffect(() => {
    return subscribeTasksChanged();
  }, [subscribeTasksChanged]);

  useEffect(() => {
    if (!workspace || loadedWorkspacePath === workspace.path) return;
    void loadTasks(workspace.path);
  }, [workspace, loadedWorkspacePath, loadTasks]);

  // 分组数据须归属当前工作区，切区瞬间旧分组不闪现
  const currentGroups = workspace && loadedWorkspacePath === workspace.path ? groups : null;
  const runningCount = currentGroups?.running.length ?? 0;
  const queuedCount = currentGroups?.queued.length ?? 0;

  if (settings.ai.unattended) {
    return (
      <div
        className="flex h-7 items-center gap-1 rounded-md bg-amber-500/15 pl-2.5 pr-1 text-xs font-medium text-amber-600 dark:text-amber-400"
        style={{ WebkitAppRegion: 'no-drag' } as CSSProperties}
      >
        <span>无人值守模式</span>
        <Button
          variant="ghost"
          size="sm"
          className="h-5 w-5 p-0 text-amber-600 hover:text-amber-700 dark:text-amber-400 dark:hover:text-amber-300"
          onClick={() => {
            saveSettings({ ...settings, ai: { ...settings.ai, unattended: false } }).catch((err) =>
              console.error('取消无人值守失败:', err),
            );
          }}
          title="取消无人值守"
        >
          <X className="w-3.5 h-3.5" />
        </Button>
      </div>
    );
  }

  if (runningCount < 1) return null;

  return (
    <div
      className="flex h-7 items-center gap-1.5 rounded-md bg-orange-500/15 px-2.5 text-xs font-medium text-orange-600 dark:text-orange-400"
      style={{ WebkitAppRegion: 'no-drag' } as CSSProperties}
    >
      <span>
        任务执行中
        {queuedCount > 0 ? ` · ${queuedCount} 排队` : ''}
      </span>
    </div>
  );
}
