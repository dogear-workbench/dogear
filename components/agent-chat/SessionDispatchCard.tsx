import { useState } from 'react';
import { ArrowUpRight, Layers, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { MarkdownRenderer } from '@/components/MarkdownRenderer';
import { CommCollapseBar, SessionPeerLink } from './AgentCommCard';
import { INJECTION_TAG_STYLES } from './injection-tags';
import { SearchHitBadge } from './SearchHitBadge';

interface DispatchItemInput {
  task?: string;
  outputPath?: string;
  title?: string;
}

interface DispatchCardProps {
  toolInput?: Record<string, unknown>;
  toolOutput?: unknown;
  isError?: boolean;
  timestamp?: number;
  /** 搜索激活命中落在本块：描边 + 徽标 + 命中期间强制展开 */
  searchHit?: boolean;
  /** 本块命中总数（仅 searchHit 时显示徽标） */
  activeMatchCount?: number;
}

function toTaskSummary(task: string): string {
  const one = task.replace(/\s+/g, ' ').trim();
  return one.length > 30 ? one.slice(0, 30) + '…' : one;
}

// sessionId 解析自 CreateSession 成功返回文本「✅ 已创建新会话 <sessionId>（…」
function parseCreatedSessionId(toolOutput: unknown): string {
  const text = typeof toolOutput === 'string' ? toolOutput : '';
  return text.match(/已创建新会话 ([^\s（「」"\\]+)/)?.[1] ?? '';
}

// 批量返回文本逐行「- <sessionId>（<title>，profile: …）→ <path>」，与 items 顺序一一对应
function parseBatchSessionIds(toolOutput: unknown): string[] {
  const text = typeof toolOutput === 'string' ? toolOutput : '';
  return text
    .split('\n')
    .map((line) => line.match(/^- ([^\s（]+)（/)?.[1] ?? '')
    .filter((sid) => sid && !sid.startsWith('('));
}

function ErrorOutput({ toolOutput }: { toolOutput?: unknown }) {
  const text = typeof toolOutput === 'string' ? toolOutput : toolOutput != null ? JSON.stringify(toolOutput, null, 2) : '';
  if (!text) return null;
  return (
    <pre className="mt-1.5 text-xs text-red-600 dark:text-red-400 whitespace-pre-wrap break-all max-h-32 overflow-y-auto">
      {text}
    </pre>
  );
}

function CardShell({ children, searchHit }: { children: React.ReactNode; searchHit: boolean }) {
  const styles = INJECTION_TAG_STYLES.dispatch;
  return (
    <div
      className={cn(
        'w-full my-2 rounded-r-lg border-l-[3px] px-3 py-2',
        styles.bar,
        searchHit
          ? 'outline-1 outline-offset-2 outline-sky-400/70 bg-sky-50/60 dark:bg-sky-950/30'
          : styles.card,
      )}
    >
      {children}
    </div>
  );
}

function DispatchBadge() {
  const styles = INJECTION_TAG_STYLES.dispatch;
  return <span className={cn('px-1.5 py-0.5 rounded text-[10px] flex-shrink-0', styles.badge)}>{styles.label}</span>;
}

function RunningHint({ text }: { text: string }) {
  return (
    <span className="inline-flex items-center gap-1 text-[10px] text-sky-600 dark:text-sky-400 flex-shrink-0">
      <Loader2 className="w-3 h-3 animate-spin" />
      {text}
    </span>
  );
}

function FailedBadge() {
  return (
    <span className="px-1.5 py-0.5 rounded text-[10px] bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300 flex-shrink-0">
      创建失败
    </span>
  );
}

function Timestamp({ timestamp }: { timestamp?: number }) {
  if (typeof timestamp !== 'number') return null;
  return <span className="flex-shrink-0 text-muted-foreground/60">{new Date(timestamp).toLocaleTimeString()}</span>;
}

function SingleDispatchCard({ toolInput, toolOutput, isError, timestamp, searchHit = false, activeMatchCount = 0 }: DispatchCardProps) {
  const [expanded, setExpanded] = useState(false);
  const running = toolOutput === undefined;
  const task = typeof toolInput?.task === 'string' ? toolInput.task : '';
  const title = typeof toolInput?.title === 'string' && toolInput.title ? toolInput.title : '';
  const outputPath = typeof toolInput?.outputPath === 'string' ? toolInput.outputPath : '';
  const name = title || toTaskSummary(task);
  const preview = title ? toTaskSummary(task) : '';
  const sessionId = parseCreatedSessionId(toolOutput);

  return (
    <CardShell searchHit={searchHit}>
      <Collapsible open={expanded || searchHit} onOpenChange={setExpanded}>
        <CollapsibleTrigger className="flex items-center gap-1.5 w-full text-xs text-muted-foreground cursor-pointer">
          <ArrowUpRight className="w-3 h-3 flex-shrink-0" />
          <span className="flex-shrink-0">派出</span>
          <span className="font-medium truncate max-w-[160px] text-foreground/80 flex-shrink-0" title={name}>
            @{name}
          </span>
          <DispatchBadge />
          {running && !isError && <RunningHint text="创建中" />}
          {isError && <FailedBadge />}
          {preview && <span className="truncate flex-1 min-w-0 text-foreground/70">{preview}</span>}
          {searchHit && activeMatchCount > 0 && <SearchHitBadge count={activeMatchCount} />}
          <Timestamp timestamp={timestamp} />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="mt-1 pt-1 border-t border-border/40">
            <div className="mb-1 flex items-start gap-1.5 text-xs text-muted-foreground">
              <ArrowUpRight className="w-3 h-3 flex-shrink-0 mt-0.5" />
              <span className="break-all">
                派出 @<SessionPeerLink sessionId={sessionId} displayName={name} />
                {sessionId && ` · ${sessionId}`}
              </span>
            </div>
            {outputPath && (
              <div className="mb-1 text-xs text-muted-foreground break-all">交付路径：{outputPath}</div>
            )}
            {task ? (
              <MarkdownRenderer content={task} className="text-xs" />
            ) : !isError ? (
              <div className="text-xs text-muted-foreground/70">（无任务内容）</div>
            ) : null}
            {isError && <ErrorOutput toolOutput={toolOutput} />}
            <CommCollapseBar onCollapse={() => setExpanded(false)} />
          </div>
        </CollapsibleContent>
      </Collapsible>
    </CardShell>
  );
}

function BatchDispatchCard({ toolInput, toolOutput, isError, timestamp, searchHit = false, activeMatchCount = 0 }: DispatchCardProps) {
  const [expanded, setExpanded] = useState(false);
  const running = toolOutput === undefined;
  const items: DispatchItemInput[] = Array.isArray(toolInput?.items) ? toolInput.items : [];
  const sessionIds = parseBatchSessionIds(toolOutput);

  return (
    <CardShell searchHit={searchHit}>
      <Collapsible open={expanded || searchHit} onOpenChange={setExpanded}>
        <CollapsibleTrigger className="flex items-center gap-1.5 w-full text-xs text-muted-foreground cursor-pointer">
          <Layers className="w-3 h-3 flex-shrink-0" />
          <span className="flex-shrink-0">批量派出 {items.length} 个子会话</span>
          <DispatchBadge />
          {running && !isError && <RunningHint text="创建中" />}
          {isError && <FailedBadge />}
          <span className="truncate flex-1 min-w-0" />
          {searchHit && activeMatchCount > 0 && <SearchHitBadge count={activeMatchCount} />}
          <Timestamp timestamp={timestamp} />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="mt-1 pt-1 border-t border-border/40">
            <div className="mb-1 text-xs text-muted-foreground break-all">批量派出 {items.length} 个子会话</div>
            {!isError && (
              <div className="space-y-1.5">
                {items.map((item, i) => {
                  const task = typeof item.task === 'string' ? item.task : '';
                  const name = item.title || toTaskSummary(task);
                  const sessionId = sessionIds[i];
                  return (
                    <div key={i} className="text-xs">
                      <div className="break-all text-foreground/80">
                        @<SessionPeerLink sessionId={sessionId} displayName={name} />
                        {sessionId && <span className="text-muted-foreground"> · {sessionId}</span>}
                      </div>
                      {item.title && task && (
                        <div className="text-muted-foreground break-all">{toTaskSummary(task)}</div>
                      )}
                      {item.outputPath && (
                        <div className="text-muted-foreground/70 break-all">→ {item.outputPath}</div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
            {isError && <ErrorOutput toolOutput={toolOutput} />}
            <CommCollapseBar onCollapse={() => setExpanded(false)} />
          </div>
        </CollapsibleContent>
      </Collapsible>
    </CardShell>
  );
}

/** 主会话派遣卡（dogear__CreateSession / CreateSessionBatch 摘壳）：单个派出一行收起，批量展开逐条列出 */
export function SessionDispatchCard(props: DispatchCardProps) {
  if (Array.isArray(props.toolInput?.items)) return <BatchDispatchCard {...props} />;
  return <SingleDispatchCard {...props} />;
}
