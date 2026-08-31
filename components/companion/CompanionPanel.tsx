import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { cn } from '@/lib/utils';
import { useUIStore } from '@/stores/ui-store';
import { WorkspaceExplorer } from '@/components/WorkspaceExplorer';
import { AdditionalFilesPanel } from '@/components/AdditionalFilesPanel';
import { TopicPanel } from '@/components/TopicPanel';
import { TerminalPanel } from '@/components/companion/TerminalPanel';

export type CompanionTab = 'files' | 'additional' | 'topic' | 'terminal';

const MIN_WIDTH = 240;
const MAX_WIDTH = 720;
const DEFAULT_WIDTHS: Record<CompanionTab, number> = {
  files: 384,
  additional: 384,
  topic: 384,
  terminal: 560,
};

const TABS: { id: CompanionTab; label: string }[] = [
  { id: 'files', label: '文件' },
  { id: 'additional', label: '附加' },
  { id: 'topic', label: '话题' },
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
}

export function CompanionPanel({ workspaceId, groupId }: CompanionPanelProps) {
  const open = useUIStore((s) => s.rightPanelOpen);
  const tab = useUIStore((s) => s.rightPanelTab);
  const setTab = useUIStore((s) => s.setRightPanelTab);

  const [width, setWidth] = useState(() => readStoredWidth(tab));
  const [dragging, setDragging] = useState(false);
  const dragOrigin = useRef<{ x: number; width: number } | null>(null);
  const widthRef = useRef(width);
  widthRef.current = width;

  useEffect(() => {
    setWidth(readStoredWidth(tab));
  }, [tab]);

  const onHandleMouseDown = (e: ReactMouseEvent) => {
    e.preventDefault();
    dragOrigin.current = { x: e.clientX, width: widthRef.current };
    setDragging(true);
  };

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: MouseEvent) => {
      if (!dragOrigin.current) return;
      const next = dragOrigin.current.width + (dragOrigin.current.x - e.clientX);
      setWidth(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, next)));
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
        open ? 'border-l' : 'border-l-0',
        dragging ? 'transition-none' : 'transition-[width] duration-200',
      )}
      style={{ width: open ? width : 0 }}
    >
      <div
        className="absolute left-0 top-0 bottom-0 w-1 z-10 cursor-col-resize hover:bg-primary/40"
        onMouseDown={onHandleMouseDown}
      />
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
      ) : (
        <TerminalPanel />
      )}
    </aside>
  );
}
