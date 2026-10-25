import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { cn } from '@/lib/utils';
import { useUIStore } from '@/stores/ui-store';
import { resolveThreeColumnLinkage } from '@/hooks/use-panel-linkage';
import { WorkspaceExplorer } from '@/components/WorkspaceExplorer';
import { AdditionalFilesPanel } from '@/components/AdditionalFilesPanel';
import { TopicPanel } from '@/components/TopicPanel';
import { TerminalPanel } from '@/components/companion/TerminalPanel';
import { ReadingPanel } from '@/components/companion/ReadingPanel';
import type { RightPanelTab } from '@/stores/ui-store';

export type CompanionTab = RightPanelTab;

const MIN_WIDTH = 240;
const MAX_WIDTH = 720;
const DEFAULT_WIDTHS: Record<CompanionTab, number> = {
  files: 384,
  additional: 384,
  topic: 384,
  reading: 560,
  terminal: 560,
};

const TABS: { id: CompanionTab; label: string }[] = [
  { id: 'files', label: '文件' },
  { id: 'additional', label: '附加' },
  { id: 'topic', label: '话题' },
  { id: 'reading', label: '阅读' },
  { id: 'terminal', label: '终端' },
];

const widthStorageKey = (tab: CompanionTab) => `companion-width:${tab}`;

function readStoredWidth(tab: CompanionTab): number {
  try {
    const raw = localStorage.getItem(widthStorageKey(tab));
    const parsed = raw === null ? NaN : Number(raw);
    if (Number.isFinite(parsed)) {
      return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, parsed));
    }
  } catch {}
  return DEFAULT_WIDTHS[tab];
}

function persistWidth(tab: CompanionTab, width: number) {
  try {
    localStorage.setItem(widthStorageKey(tab), String(Math.round(width)));
  } catch {}
}

interface CompanionPanelProps {
  workspaceId: string;
  groupId: string | null;
  /** 终端跟随锚点（伴随工作台窗口传全局焦点会话 id；缺省用主窗口 activeTabId） */
  terminalAnchor?: string | null;
  /** 独立窗口模式：忽略折叠/宽度记忆，占满容器且无拖拽把手（伴随工作台窗口用，默认面板模式不变） */
  full?: boolean;
}

export function CompanionPanel({ workspaceId, groupId, terminalAnchor, full = false }: CompanionPanelProps) {
  const open = useUIStore((s) => s.rightPanelOpen);
  const tab = useUIStore((s) => s.rightPanelTab);
  const setTab = useUIStore((s) => s.setRightPanelTab);

  const [width, setWidth] = useState(() => readStoredWidth(tab));
  const [dragging, setDragging] = useState(false);
  const dragOrigin = useRef<{ x: number; width: number } | null>(null);
  const widthRef = useRef(width);
  widthRef.current = width;

  useEffect(() => {
    const next = readStoredWidth(tab);
    setWidth(next);
    // full 模式占满容器无固定宽度，不同步；运行时宽度供三栏联动判定共享读
    if (!full) useUIStore.getState().setRightPanelWidth(next);
  }, [tab, full]);

  const onHandleMouseDown = (e: ReactMouseEvent) => {
    e.preventDefault();
    dragOrigin.current = { x: e.clientX, width: widthRef.current };
    setDragging(true);
  };

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: MouseEvent) => {
      if (!dragOrigin.current) return;
      const next = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, dragOrigin.current.width + (dragOrigin.current.x - e.clientX)));
      setWidth(next);
      useUIStore.getState().setRightPanelWidth(next);
      resolveThreeColumnLinkage('right');
    };
    const onUp = () => setDragging(false);
    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      persistWidth(tab, widthRef.current);
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [dragging, tab]);

  return (
    <aside
      className={cn(
        'relative flex flex-col bg-sidebar overflow-hidden shrink-0',
        full ? 'flex-1 min-w-0' : open ? 'border-l' : 'border-l-0',
        dragging ? 'transition-none' : 'transition-[width] duration-200',
      )}
      style={full ? undefined : { width: open ? width : 0 }}
    >
      {!full && (
        <div
          className="absolute left-0 top-0 bottom-0 w-1 z-10 cursor-col-resize hover:bg-primary/40"
          onMouseDown={onHandleMouseDown}
        />
      )}
      <div className="flex border-b shrink-0">
        {TABS.map(({ id, label }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={cn(
              'flex-1 px-3 py-2 text-xs font-medium transition-colors',
              tab === id
                ? 'border-b-2 border-primary text-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === 'files' ? (
        <WorkspaceExplorer />
      ) : tab === 'additional' ? (
        <AdditionalFilesPanel workspaceId={workspaceId} />
      ) : tab === 'topic' ? (
        <TopicPanel workspaceId={workspaceId} groupId={groupId} />
      ) : tab === 'reading' ? (
        <ReadingPanel />
      ) : tab === 'terminal' ? (
        <TerminalPanel terminalAnchor={terminalAnchor} />
      ) : null}
    </aside>
  );
}
