import { useMemo } from 'react';
import { toast } from 'sonner';
import { Eye, FileText, Newspaper, X, Quote, Ellipsis } from 'lucide-react';
import { cn } from '@/lib/utils';
import { client } from '@/lib/client';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useContainerWidth } from '@/hooks/use-container-width';
import { readingEntryKey, useMarkdownPreviewStore, type ReadingEntry, type ReadingTarget } from '@/stores/markdown-preview-store';
import { useReferenceStore } from '@/stores/reference-store';
import { guardReferenceIntoFocus, requireReferenceAnchorId } from '@/lib/reference-guard';
import { isDraftAnchorId } from '@/stores/draft-store';
import { useSessionStore, DRAFT_VIEW_ID } from '@/stores/session-store';
import { useInputFocusStore } from '@/stores/input-focus-store';
import { isArticlePath } from '@/components/workspace-explorer/tree-model';
import { ReadingContent } from './ReadingContent';
import { ArticleReadingView } from './ArticleReadingView';

/** chip 最小宽度预算：低于它就收进溢出菜单；chip 实际宽度内容自适应（max 180），预算外的宽度由 flex shrink 截断文本兑底 */
const MIN_CHIP_WIDTH = 96;
/** chip 间 gap（gap-1）计入预算 */
const CHIP_GAP = 4;
/** 溢出按钮在 bar 中占用的宽度预算 */
const OVERFLOW_BUTTON_WIDTH = 28;
/** bar 左右 padding（px-2）合计 */
const BAR_PADDING = 16;

function EntryIcon({ target }: { target: ReadingTarget }) {
  if (target.kind === 'file') {
    // 文章库内条目用报纸图标区分（渲染模式同为文章视图）
    return isArticlePath(target.filePath)
      ? <Newspaper size={12} className="shrink-0" />
      : <FileText size={12} className="shrink-0" />;
  }
  return <Eye size={12} className="shrink-0" />;
}

function entryTitle(target: ReadingTarget) {
  return target.kind === 'file' ? target.filePath : target.fileName;
}

/** 把阅读条目引用进锚定会话：file/共享文件 → 对应引用池（文章是文件引用，path 形态发送）；inline 不支持 */
async function quoteEntryIntoFocus(entry: ReadingEntry) {
  const target = entry.target;
  if (target.kind !== 'file') return;
  if (!guardReferenceIntoFocus()) return;
  const anchorId = requireReferenceAnchorId();
  if (!anchorId) return;
  const refs = useReferenceStore.getState();

  if (target.groupId) {
    const r = await client.listSharedFiles({ workspaceId: target.workspaceId, groupId: target.groupId });
    if (!r.sharedDir) {
      toast.error('共享区不可用，无法引用', { description: '话题组可能已归档' });
      return;
    }
    const absPath = r.sharedDir.endsWith('/') || r.sharedDir.endsWith('\\')
      ? `${r.sharedDir}${target.filePath}`
      : `${r.sharedDir}/${target.filePath}`;
    refs.addReferencedSharedFile({ groupId: target.groupId, relPath: target.filePath, absPath }, anchorId);
  } else {
    refs.addReferencedFile({ name: target.fileName, path: target.filePath }, anchorId);
  }

  toast.success(`已引用 ${target.fileName}`);
  const session = useSessionStore.getState();
  if (isDraftAnchorId(anchorId)) {
    session.switchTab(DRAFT_VIEW_ID);
    useInputFocusStore.getState().requestFocus(anchorId);
  } else if (session.getTab(anchorId)) {
    session.switchTab(anchorId);
    useInputFocusStore.getState().requestFocus(anchorId);
  }
}

function RecentChip({
  entry,
  active,
  hasOthers,
  onSelect,
  onClose,
  onCloseOthers,
}: {
  entry: ReadingEntry;
  active: boolean;
  hasOthers: boolean;
  onSelect: (key: string) => void;
  onClose: (key: string) => void;
  onCloseOthers: (key: string) => void;
}) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          className={cn(
            'group flex items-center gap-1 pl-2 pr-1 py-1 rounded-md border text-xs max-w-[180px] min-w-0 cursor-pointer transition-colors',
            active
              ? 'border-primary/40 bg-primary/10 text-foreground'
              : 'border-transparent text-muted-foreground hover:bg-muted hover:text-foreground',
          )}
          onClick={() => onSelect(entry.key)}
          title={entryTitle(entry.target)}
        >
          <EntryIcon target={entry.target} />
          <span className="truncate">{entry.target.fileName}</span>
          <button
            type="button"
            className="rounded p-0.5 opacity-0 group-hover:opacity-100 hover:bg-background shrink-0"
            onClick={(e) => {
              e.stopPropagation();
              onClose(entry.key);
            }}
          >
            <X size={10} />
          </button>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem disabled={entry.target.kind === 'inline'} onClick={() => void quoteEntryIntoFocus(entry)}>
          <Quote className="w-3.5 h-3.5 mr-2" />
          引用到会话
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={() => onClose(entry.key)}>
          <X className="w-3.5 h-3.5 mr-2" />
          关闭
        </ContextMenuItem>
        <ContextMenuItem disabled={!hasOthers} onClick={() => onCloseOthers(entry.key)}>
          关闭其他
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

function OverflowChipMenuItem({
  entry,
  onSelect,
  onClose,
}: {
  entry: ReadingEntry;
  onSelect: (key: string) => void;
  onClose: (key: string) => void;
}) {
  return (
    <DropdownMenuItem className="group pr-1.5" onSelect={() => onSelect(entry.key)}>
      <span className="mr-1.5 shrink-0"><EntryIcon target={entry.target} /></span>
      <span className="truncate flex-1 min-w-0" title={entryTitle(entry.target)}>{entry.target.fileName}</span>
      <button
        type="button"
        className="p-0.5 rounded hover:bg-muted shrink-0 opacity-0 group-hover:opacity-100"
        onClick={(e) => {
          e.stopPropagation();
          onClose(entry.key);
        }}
      >
        <X className="size-3" />
      </button>
    </DropdownMenuItem>
  );
}

function RecentsBar() {
  const recents = useMarkdownPreviewStore((s) => s.recents);
  const current = useMarkdownPreviewStore((s) => s.current);
  const selectEntry = useMarkdownPreviewStore((s) => s.selectEntry);
  const removeEntry = useMarkdownPreviewStore((s) => s.removeEntry);
  const removeOtherEntries = useMarkdownPreviewStore((s) => s.removeOtherEntries);
  const [barRef, barWidth] = useContainerWidth<HTMLDivElement>();

  // 容器宽度 0（面板折叠瞬间）退化为全显示，resize 后自愈
  const visibleCount = useMemo(() => {
    const total = recents.length;
    if (barWidth === 0 || total === 0) return total;
    const available = Math.max(0, barWidth - BAR_PADDING);
    if (total * (MIN_CHIP_WIDTH + CHIP_GAP) <= available) return total;
    return Math.max(1, Math.floor((available - OVERFLOW_BUTTON_WIDTH) / (MIN_CHIP_WIDTH + CHIP_GAP)));
  }, [barWidth, recents.length]);

  const visibleEntries = recents.slice(0, visibleCount);
  const overflowEntries = recents.slice(visibleCount);

  return (
    <div ref={barRef} className="flex items-center gap-1 px-2 py-1.5 border-b shrink-0 overflow-hidden">
      {visibleEntries.map((entry) => (
        <RecentChip
          key={entry.key}
          entry={entry}
          active={current !== null && readingEntryKey(current) === entry.key}
          hasOthers={recents.length > 1}
          onSelect={selectEntry}
          onClose={removeEntry}
          onCloseOthers={removeOtherEntries}
        />
      ))}
      {overflowEntries.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="flex items-center justify-center w-7 h-6 rounded-md shrink-0 text-muted-foreground hover:bg-muted hover:text-foreground"
              title="更多阅读条目"
            >
              <Ellipsis className="w-3.5 h-3.5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="max-w-[240px]">
            {overflowEntries.map((entry) => (
              <OverflowChipMenuItem
                key={entry.key}
                entry={entry}
                onSelect={selectEntry}
                onClose={removeEntry}
              />
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}

export function ReadingPanel() {
  const current = useMarkdownPreviewStore((s) => s.current);
  const hasRecents = useMarkdownPreviewStore((s) => s.recents.length > 0);
  return (
    <div className="flex flex-col flex-1 min-h-0">
      {hasRecents && <RecentsBar />}
      {current === null ? (
        <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground py-16 px-6 text-center">
          <Newspaper className="w-8 h-8 mb-2 opacity-40" />
          <p className="text-sm">从消息路径、文件树或工具预览打开 Markdown 与文章，最近读过的会显示在上方</p>
        </div>
      ) : (
        <>
          <div
            className="px-4 pt-3 pb-2 border-b shrink-0 text-sm font-medium truncate"
            title={current.kind === 'file' ? current.filePath : current.fileName}
          >
            {current.fileName}
          </div>
          {current.kind === 'file' && isArticlePath(current.filePath) ? (
            <ArticleReadingView key={readingEntryKey(current)} target={current} />
          ) : (
            <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4">
              <ReadingContent key={readingEntryKey(current)} target={current} />
            </div>
          )}
        </>
      )}
    </div>
  );
}
