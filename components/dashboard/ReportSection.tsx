import { MarkdownRenderer } from '@/components/MarkdownRenderer';
import { useDashboardStore } from '@/stores/dashboard-store';
import { useUIStore } from '@/stores/ui-store';

interface ReportSectionProps {
  workspaceId: string;
}

export function ReportSection({ workspaceId: _workspaceId }: ReportSectionProps) {
  const reportMarkdown = useDashboardStore((s) => s.reportMarkdown);
  const openSettings = useUIStore((s) => s.openSettings);

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
        生成，或在对话里说"聊聊首页"
      </p>
    </div>
  );
}
