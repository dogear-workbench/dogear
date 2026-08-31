import { useCallback, useEffect, useRef, useState } from 'react';
import { Pin, PinOff, SquareTerminal, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useSessionStore } from '@/stores/session-store';
import { useConversationStore } from '@/stores/conversation-store';
import { useTerminalStore } from '@/stores/terminal-store';
import type { Conversation } from '@/types/electron-api';
import { TerminalCard } from './TerminalCard';

const KEEP_EXPANDED = 5;
const FOLLOW_BOTTOM_THRESHOLD = 48;
const TIME_TICK_MS = 30_000;

/** 与 components/conversation-list/utils.getConversationTitle 同逻辑的兜底命名（companion 可移植纪律：不引 components 依赖链） */
function conversationTitle(conv: Conversation): string {
  if (conv.title && conv.title !== '新对话') return conv.title;
  const date = new Date(conv.created_at);
  const isToday = date.toDateString() === new Date().toDateString();
  if (isToday) return `对话 ${date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`;
  return `对话 ${date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })}`;
}

function useFollowScroll(resetKey: string | null) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const followRef = useRef(true);
  const programmaticRef = useRef(false);
  const lastScrollTopRef = useRef(0);

  useEffect(() => {
    const vp = scrollRef.current;
    if (!vp) return;
    const content = vp.firstElementChild;
    if (!content) return;
    const obs = new ResizeObserver(() => {
      if (!followRef.current) return;
      programmaticRef.current = true;
      lastScrollTopRef.current = vp.scrollHeight;
      vp.scrollTop = vp.scrollHeight;
      requestAnimationFrame(() => {
        programmaticRef.current = false;
      });
    });
    obs.observe(content);
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    const vp = scrollRef.current;
    if (!vp) return;
    const onWheel = (e: WheelEvent) => {
      if (e.deltaY < 0) followRef.current = false;
    };
    vp.addEventListener('wheel', onWheel, { passive: true, capture: true });
    return () => vp.removeEventListener('wheel', onWheel, { capture: true });
  }, []);

  useEffect(() => {
    followRef.current = true;
    const vp = scrollRef.current;
    if (!vp) return;
    programmaticRef.current = true;
    lastScrollTopRef.current = vp.scrollHeight;
    vp.scrollTop = vp.scrollHeight;
    requestAnimationFrame(() => {
      programmaticRef.current = false;
    });
  }, [resetKey]);

  const handleScroll = useCallback(() => {
    const vp = scrollRef.current;
    if (!vp) return;
    const prev = lastScrollTopRef.current;
    lastScrollTopRef.current = vp.scrollTop;
    if (!programmaticRef.current && vp.scrollTop < prev - 1) followRef.current = false;
    const distance = vp.scrollHeight - vp.scrollTop - vp.clientHeight;
    if (!followRef.current && distance <= FOLLOW_BOTTOM_THRESHOLD) followRef.current = true;
  }, []);

  return { scrollRef, handleScroll };
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-16 text-muted-foreground select-none">
      <SquareTerminal className="w-6 h-6" />
      <span className="text-xs">{text}</span>
    </div>
  );
}

export function TerminalPanel() {
  const followMode = useTerminalStore((s) => s.followMode);
  const pinnedId = useTerminalStore((s) => s.pinnedConversationId);
  const setFollowMode = useTerminalStore((s) => s.setFollowMode);
  const pinConversation = useTerminalStore((s) => s.pinConversation);
  const activeTabId = useSessionStore((s) => s.activeTabId);
  const tabs = useSessionStore((s) => s.tabs);
  const conversations = useConversationStore((s) => s.conversations);

  const [expandedOverrides, setExpandedOverrides] = useState<Map<string, boolean>>(new Map());
  const [timeTick, setTimeTick] = useState(0);

  const conversationId = followMode === 'follow' ? activeTabId : pinnedId;
  const conversationExists =
    conversationId != null &&
    (tabs.some((t) => t.conversationId === conversationId) ||
      conversations.some((c) => c.id === conversationId));

  const entries = useTerminalStore((s) =>
    conversationId ? s.buffers.get(conversationId) : undefined,
  );
  const runningIds = useTerminalStore((s) =>
    conversationId ? s.runningIds.get(conversationId) : undefined,
  );

  const { scrollRef, handleScroll } = useFollowScroll(conversationExists ? conversationId : null);

  useEffect(() => {
    if (conversationExists && conversationId) {
      void useTerminalStore.getState().ensureBuffer(conversationId);
    }
  }, [conversationId, conversationExists]);

  useEffect(() => {
    setExpandedOverrides(new Map());
  }, [conversationId]);

  useEffect(() => {
    const timer = setInterval(() => setTimeTick((n) => n + 1), TIME_TICK_MS);
    return () => clearInterval(timer);
  }, []);

  const toggleExpanded = useCallback((toolCallId: string, current: boolean) => {
    setExpandedOverrides((prev) => {
      const next = new Map(prev);
      next.set(toolCallId, !current);
      return next;
    });
  }, []);

  const activeTab = tabs.find((t) => t.conversationId === activeTabId);
  const pinnedConv = conversations.find((c) => c.id === pinnedId);
  const isPinned = followMode === 'pin';
  const list = entries ?? [];

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
            const target = activeTabId && tabs.some((t) => t.conversationId === activeTabId)
              ? activeTabId
              : pinnedId;
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
            {activeTab ? activeTab.conversationTitle : '跟随当前会话'}
          </div>
        )}
        <button
          type="button"
          title="清屏"
          disabled={!conversationExists}
          className="p-1.5 rounded-md shrink-0 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-40 disabled:pointer-events-none"
          onClick={() => {
            if (conversationId) useTerminalStore.getState().clearBuffer(conversationId);
          }}
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto" onScroll={handleScroll}>
        <div className="flex flex-col gap-2 p-2">
          {!conversationExists ? (
            <EmptyState text="打开会话后查看命令执行" />
          ) : list.length === 0 ? (
            <EmptyState text="该会话暂无命令执行" />
          ) : (
            list.map((entry, i) => {
              const running = runningIds?.has(entry.toolCallId) ?? false;
              const defaultExpanded = running || i >= list.length - KEEP_EXPANDED;
              const expanded = expandedOverrides.get(entry.toolCallId) ?? defaultExpanded;
              return (
                <TerminalCard
                  key={entry.toolCallId}
                  entry={entry}
                  running={running}
                  expanded={expanded}
                  timeTick={timeTick}
                  onToggle={toggleExpanded}
                />
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
