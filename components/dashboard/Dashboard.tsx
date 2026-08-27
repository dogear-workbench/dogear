import { useEffect } from 'react';
import { useWorkspaceStore } from '@/stores/workspace-store';
import { useDashboardStore } from '@/stores/dashboard-store';
import { ReportSection } from './ReportSection';
import { CaptureBox } from './CaptureBox';

export function Dashboard() {
  const workspace = useWorkspaceStore((s) => s.workspace);
  const setCurrentWorkspace = useDashboardStore((s) => s.setCurrentWorkspace);
  const loadReport = useDashboardStore((s) => s.loadReport);

  useEffect(() => {
    if (!workspace?.id) return;
    setCurrentWorkspace(workspace.id);
    loadReport(workspace.id);
  }, [workspace?.id, setCurrentWorkspace, loadReport]);

  if (!workspace) {
    return (
      <div className="flex-1 flex items-center justify-center bg-muted/10">
        <p className="text-sm text-muted-foreground">请选择工作区</p>
      </div>
    );
  }

  return (
    <div className="@container flex-1 overflow-hidden bg-muted/10">
      <div className="h-full px-6 py-6">
        <div className="h-full grid grid-cols-1 gap-6 @3xl:grid-cols-[5fr_3fr]">
          <div className="min-w-0 min-h-0 overflow-y-auto">
            <ReportSection workspaceId={workspace.id} />
          </div>
          <div className="min-w-0 min-h-0 overflow-y-auto">
            <CaptureBox />
          </div>
        </div>
      </div>
    </div>
  );
}
