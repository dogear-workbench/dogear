import { useEffect } from 'react';
import { Loader2, Pin, PinOff, Plus, SquareTerminal, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useSessionStore } from '@/stores/session-store';
import { useConversationStore } from '@/stores/conversation-store';
import { selectTerminalGroups, useTerminalStore, type TerminalMeta } from '@/stores/terminal-store';
import type { Conversation } from '@/types/electron-api';
import { XtermTerminal } from './XtermTerminal';

/** 与 components/conversation-list/utils.getConversationTitle 同逻辑的兜底命名（companion 可移植纪律：不引 components 依赖链） */
function conversationTitle(conv: Conversation): string {
  if (conv.title && conv.title !== '新对话') return conv.title;
  const date = new Date(conv.created_at);
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
        'group flex items-center gap-1 h-7 pl-2 pr-1 rounded-md text-xs shrink-0 max-w-44 cursor-pointer select-none',
        active ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-muted/60',
        !running && 'opacity-55',
      )}
    >
      {spinner && running && <Loader2 className="w-3 h-3 animate-spin shrink-0" />}
      <span className="truncate">{label}</span>
      {!running && exitCode !== undefined && <span className="text-[10px] whitespace-nowrap">exit {exitCode}</span>}
      <button
        type="button"
        title="结束并关闭"
        className="p-0.5 rounded shrink-0 opacity-0 group-hover:opacity-100 hover:bg-background/80 transition-opacity"
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

export function TerminalPanel() {
  const followMode = useTerminalStore((s) => s.followMode);
  const pinnedId = useTerminalStore((s) => s.pinnedConversationId);
  const setFollowMode = useTerminalStore((s) => s.setFollowMode);
  const pinConversation = useTerminalStore((s) => s.pinConversation);
  const terminals = useTerminalStore((s) => s.terminals);
  const activeTerminalId = useTerminalStore((s) => s.activeTerminalId);
  const activeTabId = useSessionStore((s) => s.activeTabId);
  const tabs = useSessionStore((s) => s.tabs);
  const conversations = useConversationStore((s) => s.conversations);

  const anchor = followMode === 'follow' ? activeTabId : pinnedId;
  const { mine, session, active } = selectTerminalGroups(terminals, anchor, activeTerminalId);

  useEffect(() => {
    void useTerminalStore.getState().ensureTerminals();
  }, []);

  useEffect(() => {
    useTerminalStore.getState().reconcileActive(anchor);
  }, [terminals, anchor]);

  const pinnedConv = conversations.find((c) => c.id === pinnedId);
  const activeTab = tabs.find((t) => t.conversationId === activeTabId);
  const isPinned = followMode === 'pin';

  const renderTab = (meta: TerminalMeta, isSessionGroup: boolean, index: number) => (
    <TerminalTab
      key={meta.terminalId}
      active={active?.terminalId === meta.terminalId}
      label={isSessionGroup ? shortCommand(meta.command) : index === 0 ? '$ shell' : `$ shell ${index + 1}`}
      title={isSessionGroup ? meta.command : undefined}
      running={!meta.exited}
      spinner={isSessionGroup}
      exitCode={meta.exitCode}
      onSelect={() => useTerminalStore.getState().setActive(meta.terminalId)}
      onClose={() => void useTerminalStore.getState().killTerminal(meta.terminalId)}
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
      </div>
      <div className="flex-1 min-h-0 relative bg-background">
        {active ? <XtermTerminal key={active.terminalId} terminalId={active.terminalId} /> : <EmptyState />}
      </div>
      <div className="flex items-center gap-0.5 h-9 border-t px-1.5 shrink-0 overflow-x-auto">
        {mine.map((meta, i) => renderTab(meta, false, i))}
        {mine.length > 0 && session.length > 0 && <div className="w-px h-4 bg-border mx-1 shrink-0" />}
        {session.map((meta, i) => renderTab(meta, true, i))}
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
