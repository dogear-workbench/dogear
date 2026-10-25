import { useCallback, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { FileText, Globe, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { client } from '@/lib/client';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useArticleStore } from '@/stores/article-store';
import { useMarkdownPreviewStore } from '@/stores/markdown-preview-store';
import { useVisiblePolling } from '@/hooks/use-visible-polling';
import type { RunHistoryEntry } from '@/types/scheduler';
import { STATUS_META } from './history-utils';
import { formatDateTimeShort, formatDuration } from '@/app/data-center/history-utils';
import { SectionHeader } from './SectionHeader';

const PAGE_LIMIT = 10;

function entryTitle(entry: RunHistoryEntry): string {
  const start = entry.startedAt ?? entry.ts;
  const parts = [formatDateTimeShort(start)];
  if (entry.endedAt !== undefined) parts.push(`耗时 ${formatDuration(entry.endedAt - start)}`);
  if (entry.error) parts.push(entry.error);
  return parts.join('\n');
}

/** 解析成功与否以文章当前内容为准：能看 → 阅读视图；否则（含已删）→ 留痕 md */
async function openEntry(entry: RunHistoryEntry): Promise<void> {
  if (!entry.articleId || !entry.workspaceId) {
    toast.info('这条记录没有文章定位信息（旧记录），无法打开');
    return;
  }
  const { open } = useMarkdownPreviewStore.getState();
  const workspaceId = entry.workspaceId;
  const traceFile = entry.traceFile;
  const openTrace = () => {
    if (!traceFile) {
      toast.info('该次解析没有留痕文件，无法查看过程');
      return;
    }
    open(workspaceId, traceFile, `解析留痕 · ${formatDateTimeShort(entry.startedAt ?? entry.ts)}`);
  };
  const r = await client.getArticleDetail({ workspaceId: entry.workspaceId, articleId: entry.articleId });
  if ('error' in r || !r.article || !r.articlePath) {
    openTrace();
    return;
  }
  if (r.article.parseStatus === 'ai_enhanced') {
    open(workspaceId, r.articlePath, r.article.title);
  } else {
    openTrace();
  }
}

/** 左栏解析记录区：最近解析记录 + 「解析文章」URL 入口（复用 article-store 提交链路） */
export function ParseHistorySection() {
  const [entries, setEntries] = useState<RunHistoryEntry[] | null>(null);
  const [inputVisible, setInputVisible] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await client.listRunHistory({ source: 'parse-article', limit: PAGE_LIMIT });
      if (!('error' in r)) setEntries(r.entries);
    } catch {
      // 静默：解析记录是辅助信息，拉取失败不打扰
    }
  }, []);

  useVisiblePolling(load, 60_000);

  return (
    <section>
      <SectionHeader
        label="解析记录"
        count={entries?.length}
        action={
          <Button
            variant="ghost"
            size="xs"
            onClick={() => setInputVisible((v) => !v)}
            title="粘贴文章 URL 解析入库"
          >
            <FileText className="w-3 h-3" />
            解析文章
          </Button>
        }
      />
      {inputVisible && <ParseUrlInput onDone={load} onHide={() => setInputVisible(false)} />}
      {entries?.length === 0 && (
        <p className="px-3 py-3 text-xs text-muted-foreground">还没有解析记录</p>
      )}
      {entries?.map((entry) => {
        const meta = STATUS_META[entry.status];
        const duration = entry.endedAt !== undefined && entry.startedAt !== undefined
          ? formatDuration(entry.endedAt - entry.startedAt)
          : '';
        const clickable = Boolean(entry.articleId && entry.workspaceId);
        return (
          <button
            key={entry.id}
            type="button"
            title={clickable ? entryTitle(entry) : `${entryTitle(entry)}\n（旧记录，无文章定位信息）`}
            onClick={() => void openEntry(entry)}
            className={cn(
              'flex w-full items-center gap-2 mx-1 rounded-sm px-2 py-1.5 text-xs text-left',
              clickable ? 'cursor-pointer hover:bg-muted/60' : 'cursor-default',
            )}
          >
            <Badge variant="outline" className={cn('shrink-0 font-normal px-1.5', meta.badgeCls)}>
              {meta.label}
            </Badge>
            <span className="truncate min-w-0" title={entry.planName}>{entry.planName}</span>
            {duration && <span className="ml-auto shrink-0 text-muted-foreground tabular-nums">{duration}</span>}
          </button>
        );
      })}
    </section>
  );
}

/** URL 输入行：值与提交复用 article-store（与文件树入口同链路，成功后自动打开阅读） */
function ParseUrlInput({ onDone, onHide }: { onDone: () => Promise<void>; onHide: () => void }) {
  const articleUrlInput = useArticleStore((s) => s.articleUrlInput);
  const setArticleUrlInput = useArticleStore((s) => s.setArticleUrlInput);
  const submitArticleUrl = useArticleStore((s) => s.submitArticleUrl);
  const parsingArticle = useArticleStore((s) => s.parsingArticle);

  const handleKeyDown = async (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      setArticleUrlInput('');
      onHide();
    } else if (e.key === 'Enter' && articleUrlInput.trim() && !parsingArticle) {
      e.preventDefault();
      const ok = await submitArticleUrl();
      if (ok) onHide();
      await onDone();
    }
  };

  return (
    <div className="flex items-center gap-1.5 mx-2 mb-1 rounded-sm border border-border bg-muted/40 px-2 py-1">
      <Globe className="w-3.5 h-3.5 shrink-0 text-green-500" />
      <input
        type="url"
        autoFocus
        className="flex-1 min-w-0 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
        placeholder="粘贴文章 URL，Enter 解析"
        value={articleUrlInput}
        onChange={(e) => setArticleUrlInput(e.target.value)}
        onKeyDown={(e) => void handleKeyDown(e)}
        disabled={parsingArticle}
      />
      {parsingArticle && <Loader2 className="w-3.5 h-3.5 shrink-0 animate-spin text-muted-foreground" />}
    </div>
  );
}
