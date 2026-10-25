import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { client } from '@/lib/client';
import { NotesPanel } from '@/components/notes/NotesPanel';
import { TitleBar } from '@/components/TitleBar';
import { useSettingsStore } from '@/stores/settings-store';
import { useWorkspaceStore } from '@/stores/workspace-store';

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
