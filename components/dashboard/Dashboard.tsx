import { useEffect } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useWorkspaceStore } from '@/stores/workspace-store';
import { useConversationStore } from '@/stores/conversation-store';
import { useDashboardStore } from '@/stores/dashboard-store';
import { ReportSection } from './ReportSection';
import { ScratchpadSection } from './ScratchpadSection';

export function Dashboard() {
  const workspace = useWorkspaceStore((s) => s.workspace);
  const newConversation = useConversationStore((s) => s.newConversation);
  const setCurrentWorkspace = useDashboardStore((s) => s.setCurrentWorkspace);
  const loadReport = useDashboardStore((s) => s.loadReport);
  const loadNotes = useDashboardStore((s) => s.loadNotes);

  useEffect(() => {
    if (!workspace?.id) return;
    setCurrentWorkspace(workspace.id);
    loadReport(workspace.id);
    loadNotes(workspace.id);
  }, [workspace?.id, setCurrentWorkspace, loadReport, loadNotes]);

  if (!workspace) {
    return (
      <div className="flex-1 flex items-center justify-center bg-muted/10">
        <p className="text-sm text-muted-foreground">请选择工作区</p>
      </div>
    );
  }

  return (
    <div className="@container flex-1 overflow-auto bg-muted/10">
      <div className="mx-auto max-w-5xl px-6 py-8 space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-base font-semibold text-foreground truncate">{workspace.name}</h1>
          <Button size="sm" onClick={() => newConversation()}>
            <Plus className="w-4 h-4" />新建对话
          </Button>
        </div>

        {/* 窄屏上下堆叠，宽屏（容器 ≥ 48rem）左报告右速记 */}
        <div className="flex flex-col gap-6 @3xl:flex-row @3xl:items-start">
          <div className="@3xl:flex-1 min-w-0">
            <ReportSection workspaceId={workspace.id} workspacePath={workspace.path} />
          </div>
          <div className="@3xl:w-80 shrink-0">
            <ScratchpadSection workspaceId={workspace.id} />
          </div>
        </div>
      </div>
    </div>
  );
}
