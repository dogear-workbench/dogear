import { useEffect } from 'react';
import { MarkdownRenderer } from '@/components/MarkdownRenderer';
import { useDashboardStore } from '@/stores/dashboard-store';
import { useUIStore } from '@/stores/ui-store';

interface ReportSectionProps {
  workspaceId: string;
}

export function ReportSection({ workspaceId }: ReportSectionProps) {
  const reportMarkdown = useDashboardStore((s) => s.reportMarkdown);
  const setCurrentWorkspace = useDashboardStore((s) => s.setCurrentWorkspace);
  const loadReport = useDashboardStore((s) => s.loadReport);
  const openSettings = useUIStore((s) => s.openSettings);

  useEffect(() => {
    setCurrentWorkspace(workspaceId);
    loadReport(workspaceId);
  }, [workspaceId, setCurrentWorkspace, loadReport]);

  if (reportMarkdown) {
    return <MarkdownRenderer content={reportMarkdown} stripHtmlComments />;
  }

  return (
    <div className="flex h-full items-center justify-center">
      <p className="text-sm text-muted-foreground">
        还没有报告，去
        <button
          type="button"
          onClick={() => openSettings()}
          className="mx-1 underline underline-offset-2 hover:text-foreground transition-colors"
        >
          设置 → 会话摘要
        </button>
        生成
      </p>
    </div>
  );
}
