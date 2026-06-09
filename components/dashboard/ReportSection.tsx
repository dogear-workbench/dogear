import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { StatusPulse } from '@/components/StatusPulse';
import { MarkdownRenderer } from '@/components/MarkdownRenderer';
import { useDashboardStore } from '@/stores/dashboard-store';

function relativeTime(isoString: string): string {
  const diff = Date.now() - new Date(isoString).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  return `${Math.floor(hours / 24)} 天前`;
}

interface ReportSectionProps {
  workspaceId: string;
  workspacePath: string;
}

export function ReportSection({ workspaceId, workspacePath }: ReportSectionProps) {
  const reportMarkdown = useDashboardStore((s) => s.reportMarkdown);
  const reportUpdatedAt = useDashboardStore((s) => s.reportUpdatedAt);
  const reviewRunning = useDashboardStore((s) => s.reviewRunningWorkspaceId === workspaceId);
  const triggerReview = useDashboardStore((s) => s.triggerReview);

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-foreground">首页报告</h2>
        <div className="flex items-center gap-3">
          {reportUpdatedAt && (
            <span className="text-xs text-muted-foreground">更新于 {relativeTime(reportUpdatedAt)}</span>
          )}
          <Button size="xs" variant="outline" disabled={reviewRunning} onClick={() => triggerReview(workspaceId, workspacePath)}>
            {reviewRunning ? (
              <><StatusPulse isPending={false} size="sm" />生成中…</>
            ) : (
              <><RefreshCw className="size-3" />刷新</>
            )}
          </Button>
        </div>
      </div>

      {reportMarkdown ? (
        <div className="rounded-lg border border-border bg-card px-4 py-3">
          <MarkdownRenderer content={reportMarkdown} />
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-border bg-muted/20 px-6 py-8 text-center">
          <p className="text-sm text-muted-foreground">
            {reviewRunning ? '正在生成报告，请稍候…' : '还没有报告，点上方「刷新」生成，或在对话里说"聊聊首页"'}
          </p>
        </div>
      )}
    </section>
  );
}
