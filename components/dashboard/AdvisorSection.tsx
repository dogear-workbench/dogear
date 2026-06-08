import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { StatusPulse } from '@/components/StatusPulse';
import { useDashboardStore } from '@/stores/dashboard-store';
import { ReviewItemGroup } from './ReviewItemGroup';

const KIND_ORDER = ['悬而未决', '未闭环', '反复出现', '已否决'] as const;

function relativeTime(isoString: string): string {
  const diff = Date.now() - new Date(isoString).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  return `${days} 天前`;
}

interface AdvisorSectionProps {
  workspaceId: string;
  workspacePath: string;
}

export function AdvisorSection({ workspaceId, workspacePath }: AdvisorSectionProps) {
  const reviewCard = useDashboardStore((s) => s.reviewCard);
  const reviewRunning = useDashboardStore((s) => s.reviewRunningWorkspaceId === workspaceId);
  const triggerReview = useDashboardStore((s) => s.triggerReview);

  const hasItems = reviewCard && reviewCard.items.length > 0;

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-foreground">复盘参谋</h2>
        <div className="flex items-center gap-3">
          {reviewCard && (
            <span className="text-xs text-muted-foreground">
              上次复盘 {relativeTime(reviewCard.reviewedAt)}
              {' · '}覆盖 {reviewCard.coveredCount} 张摘要卡
            </span>
          )}
          <Button
            size="xs"
            variant="outline"
            disabled={reviewRunning}
            onClick={() => triggerReview(workspaceId, workspacePath)}
          >
            {reviewRunning ? (
              <>
                <StatusPulse isPending={false} size="sm" />
                复盘中…
              </>
            ) : (
              <>
                <RefreshCw className="size-3" />
                刷新复盘
              </>
            )}
          </Button>
        </div>
      </div>

      {hasItems ? (
        <div className="space-y-4">
          {KIND_ORDER.map((kind) => {
            const filtered = reviewCard.items.filter((item) => item.kind === kind);
            if (filtered.length === 0) return null;
            return <ReviewItemGroup key={kind} kind={kind} items={filtered} />;
          })}
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-border bg-muted/20 px-6 py-8 text-center">
          <p className="text-sm text-muted-foreground">
            {reviewRunning
              ? '正在生成复盘，请稍候…'
              : '还没有复盘记录，点上方「刷新复盘」生成'}
          </p>
        </div>
      )}
    </section>
  );
}
