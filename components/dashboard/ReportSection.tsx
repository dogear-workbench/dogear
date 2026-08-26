import { MarkdownRenderer } from '@/components/MarkdownRenderer';
import { useDashboardStore } from '@/stores/dashboard-store';
import { useWorkspaceStore } from '@/stores/workspace-store';

interface ReportSectionProps {
  workspaceId: string;
}

export function ReportSection({ workspaceId: _workspaceId }: ReportSectionProps) {
  const reportMarkdown = useDashboardStore((s) => s.reportMarkdown);
  const openSettingsWindow = useWorkspaceStore((s) => s.openSettingsWindow);

  if (reportMarkdown) {
    return <MarkdownRenderer content={reportMarkdown} stripHtmlComments />;
  }

  return (
    <div className="flex h-full items-center justify-center">
      <p className="text-sm text-muted-foreground">
        还没有报告，去
        <button
          type="button"
          onClick={() => openSettingsWindow()}
          className="mx-1 underline underline-offset-2 hover:text-foreground transition-colors"
        >
          设置 → 会话摘要
        </button>
        生成，或在对话里说"聊聊首页"
      </p>
    </div>
  );
}
