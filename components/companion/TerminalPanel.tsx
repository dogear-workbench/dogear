import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ChevronDown, Loader2, Pin, PinOff, Plus, SquareTerminal, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useSessionStore } from '@/stores/session-store';
import { useConversationStore } from '@/stores/conversation-store';
import { selectTerminalGroups, useTerminalStore, type TerminalMeta } from '@/stores/terminal-store';
import type { Conversation } from '@/types/electron-api';
import { XtermTerminal } from './XtermTerminal';

/** 与 components/conversation-list/utils.getConversationTitle 同逻辑的兜底命名（companion 可移植纪律：不引 components 依赖链） */
function conversationTitle(conv: Conversation): string {
  if (conv.title && conv.title !== '新对话') return conv.title;
  const date = new Date(conv.createdAt);
  const isToday = date.toDateString() === new Date().toDateString();
  if (isToday) return `对话 ${date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`;
  return `对话 ${date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })}`;
}

function shortCommand(command: string): string {
  const text = command.replace(/\s+/g, ' ').trim();
  return text.length > 16 ? `${text.slice(0, 16)}…` : text;
}

function EmptyState() {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-muted-foreground select-none">
      <SquareTerminal className="w-6 h-6" />
      <span className="text-xs">点下方 + 打开 shell，或让 agent 后台运行命令</span>
    </div>
  );
}

function StatusIndicator({ running, spinner }: { running: boolean; spinner: boolean }) {
  if (running && spinner) return <Loader2 className="w-3 h-3 animate-spin shrink-0" />;
  if (running) return <span className="w-1.5 h-1.5 rounded-full shrink-0 bg-orange-500 animate-pulse" />;
  return <span className="w-1.5 h-1.5 rounded-full shrink-0 bg-muted-foreground" />;
}

interface TerminalTabProps {
  active: boolean;
  label: string;
  title?: string;
  running: boolean;
  spinner?: boolean;
  exitCode?: number;
  onSelect: () => void;
  onClose: () => void;
}

function TerminalTab({ active, label, title, running, spinner = false, exitCode, onSelect, onClose }: TerminalTabProps) {
  return (
    <div
      role="tab"
      aria-selected={active}
      title={title ?? label}
      onClick={onSelect}
      className={cn(
        'group flex items-center gap-1 h-7 w-32 px-2 rounded-md text-xs shrink-0 cursor-pointer select-none',
        running ? 'text-foreground' : 'text-muted-foreground',
        active ? 'bg-muted' : 'hover:bg-muted/60',
      )}
    >
      <StatusIndicator running={running} spinner={spinner} />
      <span className="truncate">{label}</span>
      {!running && exitCode !== undefined && <span className="text-[10px] whitespace-nowrap shrink-0">exit {exitCode}</span>}
      <button
        type="button"
        title="结束并关闭"
        className="ml-auto p-0.5 rounded shrink-0 opacity-0 group-hover:opacity-100 hover:bg-background/80 transition-opacity"
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
      >
        <X className="w-3 h-3" />
      </button>
    </div>
  );
}

interface TabEntry {
  meta: TerminalMeta;
  label: string;
  fullLabel: string;
  spinner: boolean;
}

const TAB_STEP = 130;
const RESERVE_BASE = 44;
const RESERVE_OVERFLOW = 86;

function computeVisibleCount(containerWidth: number, tabCount: number): number {
  const base = Math.floor((containerWidth - RESERVE_BASE) / TAB_STEP);
  if (tabCount <= base) return base;
  return Math.max(0, Math.floor((containerWidth - RESERVE_BASE - RESERVE_OVERFLOW) / TAB_STEP));
}

/** 激活保底：激活 tab 落在溢出区时强制换入可见区末位，挤出的进下拉 */
function splitTabs(ordered: TabEntry[], visibleCount: number, activeId: string | null): { visible: TabEntry[]; overflow: TabEntry[] } {
  const count = Math.min(ordered.length, Math.max(0, visibleCount));
  if (ordered.length <= count) return { visible: ordered, overflow: [] };
  const activeIndex = ordered.findIndex((t) => t.meta.terminalId === activeId);
  if (activeIndex >= count) {
    const visible = count > 0 ? [...ordered.slice(0, count - 1), ordered[activeIndex]] : [ordered[activeIndex]];
    const visibleIds = new Set(visible.map((t) => t.meta.terminalId));
    return { visible, overflow: ordered.filter((t) => !visibleIds.has(t.meta.terminalId)) };
  }
  return { visible: ordered.slice(0, count), overflow: ordered.slice(count) };
}

interface TerminalPanelProps {
  /** 窗口级终端跟随锚点（伴随工作台传全局焦点会话 id）；缺省回退主窗口 activeTabId */
  terminalAnchor?: string | null;
}

export function TerminalPanel({ terminalAnchor }: TerminalPanelProps) {
  const followMode = useTerminalStore((s) => s.followMode);
  const pinnedId = useTerminalStore((s) => s.pinnedConversationId);
  const setFollowMode = useTerminalStore((s) => s.setFollowMode);
  const pinConversation = useTerminalStore((s) => s.pinConversation);
  const terminals = useTerminalStore((s) => s.terminals);
  const activeTerminalId = useTerminalStore((s) => s.activeTerminalId);
  const activeTabId = useSessionStore((s) => s.activeTabId);
  const conversations = useConversationStore((s) => s.conversations);

  const windowAnchor = terminalAnchor ?? activeTabId;
  const anchor = followMode === 'follow' ? windowAnchor : pinnedId;
  const { mine, session, active } = selectTerminalGroups(terminals, anchor, activeTerminalId);

  const tabBarRef = useRef<HTMLDivElement>(null);
  const [barWidth, setBarWidth] = useState<number | null>(null);

  useEffect(() => {
    void useTerminalStore.getState().ensureTerminals();
  }, []);

  useEffect(() => {
    useTerminalStore.getState().reconcileActive(anchor);
  }, [terminals, anchor]);

  useLayoutEffect(() => {
    const el = tabBarRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) setBarWidth(entry.contentRect.width);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const pinnedConv = conversations.find((c) => c.id === pinnedId);
  const anchorConv = conversations.find((c) => c.id === windowAnchor);
  const isPinned = followMode === 'pin';

  const orderedTabs: TabEntry[] = [
    ...mine.map((meta, i) => ({
      meta,
      label: i === 0 ? '$ shell' : `$ shell ${i + 1}`,
      fullLabel: i === 0 ? '$ shell' : `$ shell ${i + 1}`,
      spinner: false,
    })),
    ...session.map((meta) => ({
      meta,
      label: shortCommand(meta.command),
      fullLabel: meta.command,
      spinner: true,
    })),
  ];
  const visibleCount = barWidth === null ? orderedTabs.length : computeVisibleCount(barWidth, orderedTabs.length);
  const { visible, overflow } = splitTabs(orderedTabs, visibleCount, active?.terminalId ?? null);

  const renderTab = (entry: TabEntry) => (
    <TerminalTab
      key={entry.meta.terminalId}
      active={active?.terminalId === entry.meta.terminalId}
      label={entry.label}
      title={entry.fullLabel}
      running={!entry.meta.exited}
      spinner={entry.spinner}
      exitCode={entry.meta.exitCode}
      onSelect={() => useTerminalStore.getState().setActive(entry.meta.terminalId)}
      onClose={() => void useTerminalStore.getState().killTerminal(entry.meta.terminalId)}
    />
  );

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="flex items-center gap-1.5 px-2 h-9 border-b shrink-0">
        <button
          type="button"
          title={isPinned ? '取消固定，跟随当前会话' : '固定到当前会话'}
          className={cn(
            'p-1.5 rounded-md shrink-0 transition-colors',
            isPinned ? 'text-primary bg-primary/10' : 'text-muted-foreground hover:text-foreground hover:bg-muted',
          )}
          onClick={() => {
            if (isPinned) {
              setFollowMode('follow');
              return;
            }
            const target = anchorConv ? windowAnchor : pinnedId;
            if (target) pinConversation(target);
          }}
        >
          {isPinned ? <PinOff className="w-3.5 h-3.5" /> : <Pin className="w-3.5 h-3.5" />}
        </button>
        {isPinned ? (
          <Select value={pinnedId ?? undefined} onValueChange={pinConversation}>
            <SelectTrigger className="h-7 flex-1 min-w-0 text-xs">
              <SelectValue>{pinnedConv ? conversationTitle(pinnedConv) : '选择会话'}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {conversations.map((conv) => (
                <SelectItem key={conv.id} value={conv.id} className="text-xs">
                  {conversationTitle(conv)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <div className="flex-1 min-w-0 truncate text-xs text-muted-foreground">
            {anchorConv ? conversationTitle(anchorConv) : '跟随当前会话'}
          </div>
        )}
      </div>
      <div className="flex-1 min-h-0 relative bg-background">
        {active ? <XtermTerminal key={active.terminalId} terminalId={active.terminalId} /> : <EmptyState />}
      </div>
      <div ref={tabBarRef} className="flex items-center gap-0.5 h-9 border-t px-1.5 shrink-0 overflow-hidden">
        {visible.map(renderTab)}
        {overflow.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                title={`${overflow.length} 个终端收起`}
                className="flex items-center gap-1 h-7 px-2 rounded-md text-xs shrink-0 text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
              >
                <span>更多</span>
                <ChevronDown className="w-3.5 h-3.5" />
                <span className="min-w-4 h-4 px-1 rounded-full bg-muted-foreground/15 text-[10px] leading-4 flex items-center justify-center">
                  {overflow.length}
                </span>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="top" align="end" className="max-w-sm">
              {overflow.map((entry) => (
                <DropdownMenuItem
                  key={entry.meta.terminalId}
                  className={cn('group gap-2 text-xs', entry.meta.exited ? 'text-muted-foreground' : 'text-foreground')}
                  onSelect={() => useTerminalStore.getState().setActive(entry.meta.terminalId)}
                >
                  <StatusIndicator running={!entry.meta.exited} spinner={entry.spinner} />
                  <span className="flex-1 min-w-0 whitespace-normal break-all">{entry.fullLabel}</span>
                  {entry.meta.exited && entry.meta.exitCode !== undefined && (
                    <span className="text-[10px] whitespace-nowrap shrink-0">exit {entry.meta.exitCode}</span>
                  )}
                  <button
                    type="button"
                    title="结束并关闭"
                    className="p-0.5 rounded shrink-0 opacity-0 group-hover:opacity-100 hover:bg-background/80 transition-opacity"
                    onClick={(e) => {
                      e.stopPropagation();
                      void useTerminalStore.getState().killTerminal(entry.meta.terminalId);
                    }}
                  >
                    <X className="w-3 h-3" />
                  </button>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        <button
          type="button"
          title="新建 shell"
          className="ml-auto p-1.5 rounded-md shrink-0 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          onClick={() => void useTerminalStore.getState().openUserShell()}
        >
          <Plus className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
