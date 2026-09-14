import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { client } from '@/lib/client';
import { rendererEvents } from '@/lib/events';
import { NotesPanel } from '@/components/notes/NotesPanel';
import { TitleBar } from '@/components/TitleBar';
import { useSettingsStore } from '@/stores/settings-store';
import { useWorkspaceStore } from '@/stores/workspace-store';
import { useTaskFocusStore } from '@/stores/task-focus-store';

export function NotesWindowPage() {
  const [initError, setInitError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  const workspace = useWorkspaceStore((s) => s.workspace);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (!useSettingsStore.getState().loaded) {
          await useSettingsStore.getState().loadSettings();
        }

        const [defaultWs, allResult] = await Promise.all([
          client.getDefault(),
          client.getAll(),
        ]);
        if (cancelled) return;
        const ws = defaultWs ?? allResult.workspaces?.[0];
        if (!ws) {
          setInitError('没有可用工作区，请先在主窗口创建工作区');
          return;
        }

        // skipSetDefault：不回写默认工作区，避免独立窗口影响主窗口
        await useWorkspaceStore.getState().setWorkspace(ws, { skipSetDefault: true });
        if (cancelled) return;
        setReady(true);
      } catch (err) {
        console.error('[notes-window] 初始化失败:', err);
        if (!cancelled) setInitError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // 主进程直发的任务定位（通知点击）：切到目标工作区（如需）后请求任务视图选中
  useEffect(() => {
    const unsub = rendererEvents.notesTaskFocus.listen(({ taskId, workspaceId }) => {
      (async () => {
        try {
          const currentWs = useWorkspaceStore.getState().workspace;
          if (currentWs?.id !== workspaceId) {
            const { workspaces } = await client.getAll();
            const target = workspaces?.find((w) => w.id === workspaceId);
            if (!target) return;
            await useWorkspaceStore.getState().setWorkspace(target, { skipSetDefault: true });
          }
          useTaskFocusStore.getState().requestTaskFocus(taskId);
        } catch (err) {
          console.error('[notes-window] 任务定位失败:', err);
        }
      })();
    });
    return () => unsub();
  }, []);

  return (
    <div className="h-full flex flex-col bg-background">
      <TitleBar title="笔记" />
      {initError ? (
        <div className="flex-1 flex items-center justify-center px-6 text-sm text-muted-foreground text-center">
          {initError}
        </div>
      ) : !ready || !workspace ? (
        <div className="flex-1 flex items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" />
          加载中...
        </div>
      ) : (
        <div className="flex-1 min-h-0 flex flex-col">
          <NotesPanel />
        </div>
      )}
    </div>
  );
}
