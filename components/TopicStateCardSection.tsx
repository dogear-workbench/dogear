import { useState } from 'react';
import { toast } from 'sonner';
import { Check, X } from 'lucide-react';
import { client } from '@/lib/client';
import { Button } from '@/components/ui/button';

export interface TopicEntryView {
  id: string;
  text: string;
  source: string;
  ts: string;
}

export interface TopicVersionView {
  text: string;
  source: string;
  ts: string;
}

export interface TopicStateCardView {
  groupId: string;
  updatedAt: string;
  topicHistory: TopicVersionView[];
  pendingTopicChanges: TopicVersionView[];
  entries: {
    completed: TopicEntryView[];
    inProgress: TopicEntryView[];
    decisions: TopicEntryView[];
    blockers: TopicEntryView[];
    nextSteps: TopicEntryView[];
    openQuestions: TopicEntryView[];
  };
}

const CATEGORY_ORDER = ['inProgress', 'completed', 'nextSteps', 'blockers', 'decisions', 'openQuestions'] as const;
const CATEGORY_LABELS: Record<(typeof CATEGORY_ORDER)[number], string> = {
  inProgress: '进行中',
  completed: '已完成',
  nextSteps: '下一步',
  blockers: '阻碍',
  decisions: '已拍板',
  openQuestions: '待议',
};

function formatTs(v: string): string {
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return v;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function SourceBadge({ source }: { source: string }) {
  const label = source === 'user' ? '用户' : source === 'legacy' ? '迁移' : `会话 ${source.split('#')[0].slice(-6)}`;
  return (
    <span className="shrink-0 rounded bg-muted px-1 py-px text-[10px] text-muted-foreground">{label}</span>
  );
}

function topicOriginLabel(source: string): string {
  if (source === 'user') return '用户确认';
  if (source === 'legacy') return '早期记录';
  return `来自会话 ${source.split('#')[0].slice(-6)}`;
}

function PendingChangeCard({
  workspaceId,
  groupId,
  text,
  source,
  ts,
  index,
  busy,
  onBusyChange,
}: {
  workspaceId: string;
  groupId: string;
  text: string;
  source: string;
  ts: string;
  index: number;
  busy: boolean;
  onBusyChange: (busy: boolean) => void;
}) {
  const resolve = async (accept: boolean) => {
    onBusyChange(true);
    try {
      const r = await client.confirmTopicChange({ workspaceId, groupId, index, accept });
      if (r.error) {
        toast.error(accept ? '确认话题变更失败' : '拒绝话题变更失败', { description: r.error });
        return;
      }
      toast.success(accept ? '已确认为生效话题' : '已拒绝该变更');
    } finally {
      onBusyChange(false);
    }
  };

  return (
    <div className="rounded-sm border border-amber-500/40 bg-amber-500/5 p-2">
      <div className="flex items-start gap-1.5">
        <p className="flex-1 min-w-0 text-xs text-foreground/90 whitespace-pre-wrap">{text}</p>
        <SourceBadge source={source} />
      </div>
      <div className="mt-1.5 flex items-center justify-between gap-2">
        <span className="text-[10px] text-muted-foreground/70">{formatTs(ts)}</span>
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="sm"
            className="h-5 px-1.5 text-[10px]"
            disabled={busy}
            onClick={() => void resolve(true)}
          >
            <Check className="mr-0.5 w-3 h-3" />接受
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-5 px-1.5 text-[10px] text-muted-foreground"
            disabled={busy}
            onClick={() => void resolve(false)}
          >
            <X className="mr-0.5 w-3 h-3" />拒绝
          </Button>
        </div>
      </div>
    </div>
  );
}

export function TopicStateCardSection({
  workspaceId,
  groupId,
  card,
}: {
  workspaceId: string;
  groupId: string;
  card: TopicStateCardView | null;
}) {
  const [busyIndex, setBusyIndex] = useState<number | null>(null);

  if (!card) {
    return <div className="px-2 py-3 text-xs text-muted-foreground">话题状态尚未生成，开启会话后自动提炼</div>;
  }

  const isEmpty = !card.topicHistory.length
    && Object.values(card.entries).every((items) => items.length === 0);
  if (isEmpty) {
    return <div className="px-2 py-3 text-xs text-muted-foreground">暂无状态记录，开启会话后自动提炼</div>;
  }

  const topic = card.topicHistory.length
    ? card.topicHistory[card.topicHistory.length - 1]
    : null;
  const establishedTs = card.topicHistory.length ? card.topicHistory[0].ts : null;

  return (
    <div className="space-y-2 px-2 py-1.5">
      {topic && (
        <div>
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-0.5">话题</div>
          <div className="text-xs font-medium">{topic.text}</div>
          <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-muted-foreground/70">
            <span>确立于 {establishedTs ? formatTs(establishedTs) : formatTs(topic.ts)}</span>
            <span>·</span>
            <span>{topicOriginLabel(topic.source)}</span>
          </div>
        </div>
      )}

      {card.pendingTopicChanges.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-[10px] tracking-wide text-amber-600 dark:text-amber-400">
            {card.pendingTopicChanges.length} 条话题变更待确认
          </div>
          {card.pendingTopicChanges.map((v, i) => (
            <PendingChangeCard
              key={`${v.text}-${v.ts}-${i}`}
              workspaceId={workspaceId}
              groupId={groupId}
              text={v.text}
              source={v.source}
              ts={v.ts}
              index={i}
              busy={busyIndex === i}
              onBusyChange={(busy) => setBusyIndex(busy ? i : null)}
            />
          ))}
        </div>
      )}

      {CATEGORY_ORDER.map((cat) => {
        const items = card.entries[cat];
        if (!items.length) return null;
        return (
          <div key={cat}>
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-0.5">{CATEGORY_LABELS[cat]}</div>
            <ul className="space-y-1">
              {items.map((e) => (
                <li key={e.id} className="flex items-start gap-1.5">
                  <span className="text-xs text-foreground/90 whitespace-pre-wrap flex-1 min-w-0">{e.text}</span>
                  <SourceBadge source={e.source} />
                  <span className="shrink-0 text-[10px] text-muted-foreground/60 leading-4">{formatTs(e.ts)}</span>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
