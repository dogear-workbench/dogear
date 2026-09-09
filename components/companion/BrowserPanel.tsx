import { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  Camera,
  ChevronDown,
  ChevronUp,
  Clock,
  Database,
  ExternalLink,
  Eye,
  FileText,
  Globe,
  Hourglass,
  MousePointerClick,
  Navigation,
  PenLine,
  Square,
  Type,
  ArrowUpDown,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useBrowserStore } from '@/stores/browser-store';
import { useSessionStore } from '@/stores/session-store';
import { useConversationStore } from '@/stores/conversation-store';
import { BrowserPageView } from './BrowserPageView';
import { BrowserInterventions } from './BrowserInterventions';
import type {
  BrowserActionEvent,
  BrowserActionType,
  BrowserStreamStatus,
} from '@/electron/main/services/browser/browser-action-stream';

const ACTION_ICONS: Record<BrowserActionType, typeof Activity> = {
  navigate: Navigation,
  wait: Clock,
  click: MousePointerClick,
  observe: Eye,
  parse: FileText,
  fill: PenLine,
  scroll: ArrowUpDown,
  read_text: Type,
  read_state: Database,
  wait_for: Hourglass,
  screenshot: Camera,
  close: Square,
  present: ExternalLink,
  await_human: Hourglass,
};

const ACTION_LABELS: Record<BrowserActionType, string> = {
  navigate: '导航',
  wait: '等待',
  click: '点击',
  observe: '观察',
  parse: '解析',
  fill: '填写',
  scroll: '滚动',
  read_text: '读取',
  read_state: '读状态',
  wait_for: '等待条件',
  screenshot: '截图',
  close: '结束',
  present: '呈现',
  await_human: '等待人工',
};

const BAD_RESULT_RE = /^(error|timeout|need_login|browser_crash|parse_empty|value_mismatch)$/;
const GOOD_RESULT_RE = /^(ok|clicked|filled|expanded|domcontentloaded)$/;

function resultTone(result: string): 'good' | 'bad' | 'neutral' {
  if (BAD_RESULT_RE.test(result)) return 'bad';
  if (GOOD_RESULT_RE.test(result)) return 'good';
  return 'neutral';
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('zh-CN', { hour12: false });
}

function formatDayTime(ts: number): string {
  const d = new Date(ts);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  return sameDay
    ? d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })
    : d.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
}

function hostnameOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

function shortId(id: string): string {
  return id.length > 8 ? id.slice(0, 8) : id;
}

interface TaskGroup {
  taskId: string;
  kind: 'article' | 'agent';
  label: string;
  firstTs: number;
  lastTs: number;
  events: BrowserActionEvent[];
}

function buildGroups(events: BrowserActionEvent[]): TaskGroup[] {
  const ordered = [...events].sort((a, b) => a.seq - b.seq);
  const map = new Map<string, TaskGroup>();
  for (const event of ordered) {
    let group = map.get(event.taskId);
    if (!group) {
      group = { taskId: event.taskId, kind: event.kind, label: '', firstTs: event.ts, lastTs: event.ts, events: [] };
      map.set(event.taskId, group);
    }
    group.lastTs = Math.max(group.lastTs, event.ts);
    group.events.push(event);
  }
  return [...map.values()];
}

function ResultBadge({ result }: { result: string }) {
  const tone = resultTone(result);
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1 max-w-40 px-1 rounded text-[10px] leading-4 truncate',
        tone === 'good' && 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
        tone === 'bad' && 'bg-red-500/10 text-red-600 dark:text-red-400',
        tone === 'neutral' && 'bg-muted text-muted-foreground',
      )}
      title={result}
    >
      {result}
    </span>
  );
}

function ActionCard({ event }: { event: BrowserActionEvent }) {
  const Icon = ACTION_ICONS[event.action] ?? Activity;
  return (
    <div className="flex gap-2 px-3 py-1.5 hover:bg-muted/40 transition-colors">
      <Icon className="w-3.5 h-3.5 mt-0.5 shrink-0 text-muted-foreground" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className="shrink-0 text-xs font-medium">{ACTION_LABELS[event.action]}</span>
          {event.detail && <span className="flex-1 min-w-0 truncate text-xs text-muted-foreground" title={event.detail}>{event.detail}</span>}
          {event.result && <ResultBadge result={event.result} />}
          <span className="ml-auto shrink-0 text-[10px] text-muted-foreground/70 tabular-nums">{formatTime(event.ts)}</span>
        </div>
        {event.url && (
          <div className="truncate text-[10px] text-muted-foreground/70" title={event.url}>{event.url}</div>
        )}
      </div>
    </div>
  );
}

function StatusLine({ status, runningLabel }: { status: BrowserStreamStatus; runningLabel: string | null }) {
  const stateText = status.running
    ? `运行中 · ${runningLabel ?? '浏览器任务'}`
    : status.launched
      ? '空闲 · 内嵌浏览器已启动'
      : '空闲';
  return (
    <div className="flex items-center gap-2 px-3 h-9 border-b shrink-0 text-xs">
      <Globe className={cn('w-3.5 h-3.5 shrink-0', status.running ? 'text-primary' : 'text-muted-foreground')} />
      <span className={cn('truncate', status.running ? 'text-foreground' : 'text-muted-foreground')}>{stateText}</span>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-2 text-muted-foreground select-none">
      <Globe className="w-6 h-6" />
      <span className="text-xs">暂无浏览器动作，读取网页文章或让 agent 使用浏览器工具</span>
    </div>
  );
}

function GroupedList({ groups, holderTaskId }: { groups: TaskGroup[]; holderTaskId: string | null }) {
  return (
    <>
      {groups.map((group) => {
        const running = holderTaskId === group.taskId;
        return (
          <div key={group.taskId} className="border-b last:border-b-0">
            <div className="flex items-center gap-2 px-3 py-1.5 bg-muted/40 sticky top-0 z-10">
              <span
                className={cn(
                  'w-1.5 h-1.5 rounded-full shrink-0',
                  running ? 'bg-orange-500 animate-pulse' : 'bg-muted-foreground/50',
                )}
              />
              <span className="flex-1 min-w-0 truncate text-xs font-medium" title={group.label}>{group.label}</span>
              <span className="shrink-0 text-[10px] text-muted-foreground/70 tabular-nums">{formatDayTime(group.firstTs)}</span>
            </div>
            {group.events.map((event, i) => (
              <ActionCard key={`${event.seq}-${i}`} event={event} />
            ))}
          </div>
        );
      })}
    </>
  );
}

/** 底部日志抽屉：收起时一行入口，展开后限高滚动（页面呈现时不再挤占页面空间） */
function LogDrawer({
  count,
  open,
  onToggle,
  children,
}: {
  count: number;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="border-t shrink-0">
      <button
        className="flex w-full items-center gap-2 px-3 h-8 text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
        onClick={onToggle}
      >
        {open ? <ChevronDown className="w-3.5 h-3.5 shrink-0" /> : <ChevronUp className="w-3.5 h-3.5 shrink-0" />}
        操作记录 {count} 条
      </button>
      {open && <div className="max-h-64 overflow-y-auto border-t">{children}</div>}
    </div>
  );
}

export function BrowserPanel() {
  const events = useBrowserStore((s) => s.events);
  const status = useBrowserStore((s) => s.status);
  const tabs = useBrowserStore((s) => s.view.tabs);
  const sessionTabs = useSessionStore((s) => s.tabs);
  const conversations = useConversationStore((s) => s.conversations);
  const [logOpen, setLogOpen] = useState(false);
  useEffect(() => {
    void useBrowserStore.getState().ensureLoaded();
  }, []);

  const labelByTaskId = useMemo(() => {
    const map = new Map<string, string>();
    for (const tab of sessionTabs) map.set(`agent:${tab.conversationId}`, tab.conversationTitle);
    for (const conv of conversations) {
      const key = `agent:${conv.id}`;
      if (!map.has(key) && conv.title && conv.title !== '新对话') map.set(key, conv.title);
    }
    return map;
  }, [sessionTabs, conversations]);

  const groups = useMemo(() => {
    const list = buildGroups(events);
    for (const group of list) {
      if (group.kind === 'article') {
        const host = hostnameOf(group.events.find((e) => e.url)?.url);
        group.label = host ? `手动解析 · ${host}` : '手动解析';
      } else {
        const conversationId = group.taskId.slice('agent:'.length);
        group.label = labelByTaskId.get(group.taskId) ?? `会话 ${shortId(conversationId)}`;
      }
    }
    // 运行中任务置顶，其余按最近动作倒序
    return list.sort((a, b) => {
      const aRunning = status.holder?.taskId === a.taskId ? 1 : 0;
      const bRunning = status.holder?.taskId === b.taskId ? 1 : 0;
      if (aRunning !== bRunning) return bRunning - aRunning;
      return b.lastTs - a.lastTs;
    });
  }, [events, status.holder, labelByTaskId]);

  const runningLabel = status.holder
    ? groups.find((g) => g.taskId === status.holder?.taskId)?.label ?? null
    : null;

  const hasTabs = tabs.length > 0;
  const holderTaskId = status.holder?.taskId ?? null;

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <StatusLine status={status} runningLabel={runningLabel} />
      <BrowserInterventions />
      <BrowserPageView />
      {hasTabs ? (
        <LogDrawer count={events.length} open={logOpen} onToggle={() => setLogOpen((v) => !v)}>
          <GroupedList groups={groups} holderTaskId={holderTaskId} />
        </LogDrawer>
      ) : groups.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto">
          <GroupedList groups={groups} holderTaskId={holderTaskId} />
        </div>
      )}
    </div>
  );
}
