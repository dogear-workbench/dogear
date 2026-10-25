import { useCallback } from 'react';
import { SquarePen, X } from 'lucide-react';
import {
  ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { draftAnchorId, useDraftStore } from '@/stores/draft-store';
import { useReferenceStore, type ReferenceState } from '@/stores/reference-store';
import { useSessionStore, DRAFT_VIEW_ID } from '@/stores/session-store';
import { useWorkspaceStore } from '@/stores/workspace-store';
import { showConfirm } from '@/stores/confirm-store';

interface DraftRowProps {
  /** 话题语境传话题名（标题「话题名 · 新会话」）；新话题语境不传（标题「新话题」） */
  groupTitle?: string;
  indent?: number;
}

const countAnchoredRefs = (s: ReferenceState, anchorId: string): number =>
  s.quotedSnippets.filter((r) => r.anchorConversationId === anchorId).length +
  s.messageSnippets.filter((r) => r.anchorConversationId === anchorId).length +
  s.fileSnippets.filter((r) => r.anchorConversationId === anchorId).length +
  s.referencedFiles.filter((r) => r.anchorConversationId === anchorId).length +
  s.referencedConversations.filter((r) => r.anchorConversationId === anchorId).length +
  s.referencedSharedFiles.filter((r) => r.anchorConversationId === anchorId).length +
  s.referencedNotes.filter((r) => r.anchorConversationId === anchorId).length;

export function DraftRow({ groupTitle, indent = 8 }: DraftRowProps) {
  const workspaceId = useWorkspaceStore((s) => s.workspace?.id) ?? '';
  const slot = useDraftStore((s) => s.slots[workspaceId]);
  const refCount = useReferenceStore((s) => countAnchoredRefs(s, draftAnchorId(workspaceId)));
  const isDraftFocused = useSessionStore((s) => s.activeTabId) === DRAFT_VIEW_ID;

  const preview = slot?.input.trim() ?? '';
  const imageCount = slot?.pendingImages.length ?? 0;
  const title = groupTitle ? `${groupTitle} · 新会话` : '新话题';

  const handleClick = useCallback(() => {
    useSessionStore.getState().switchTab(DRAFT_VIEW_ID);
  }, []);

  const handleDiscard = useCallback(async () => {
    const wsId = useWorkspaceStore.getState().workspace?.id;
    if (!wsId || useDraftStore.getState().creating) return;
    const anchorId = draftAnchorId(wsId);
    const s = useDraftStore.getState().getSlot(wsId);
    const hasContent =
      !!s && (s.input.trim().length > 0 || s.pendingImages.length > 0 || countAnchoredRefs(useReferenceStore.getState(), anchorId) > 0);
    if (hasContent) {
      const ok = await showConfirm('放弃草稿？', '将清除草稿的输入内容、图片和全部引用。');
      if (!ok) return;
    }
    useReferenceStore.getState().clearAllFor(anchorId);
    useDraftStore.getState().clear();
    if (useSessionStore.getState().activeTabId === DRAFT_VIEW_ID) {
      useSessionStore.getState().fallbackActiveTab();
    }
  }, []);

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          className={cn(
            'relative flex items-center gap-2 py-2 pr-3 cursor-pointer transition-colors group rounded-sm mx-1',
            isDraftFocused ? 'bg-blue-100 dark:bg-blue-900/30' : 'opacity-80 hover:opacity-100 hover:bg-muted/30',
          )}
          style={{ paddingLeft: `${indent}px` }}
          onClick={handleClick}
        >
          <SquarePen className="w-4 h-4 flex-shrink-0 text-muted-foreground/60" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="shrink-0 text-[10px] leading-3 px-1 py-0.5 rounded-sm border border-dashed border-muted-foreground/50 text-muted-foreground">
                草稿
              </span>
              <span
                className={cn(
                  'text-sm truncate',
                  isDraftFocused ? 'text-blue-700 dark:text-blue-300 font-medium' : 'text-muted-foreground',
                )}
              >
                {title}
              </span>
            </div>
            <div className="flex items-center gap-1 text-xs text-muted-foreground/70 min-w-0">
              {preview ? (
                <span className="truncate" title={preview}>{preview}</span>
              ) : (
                <span>空草稿</span>
              )}
              {imageCount > 0 && <span className="shrink-0">· 图片×{imageCount}</span>}
              {refCount > 0 && <span className="shrink-0">· 引用×{refCount}</span>}
              <span className="ml-auto flex items-center shrink-0 opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto group-data-[state=open]:opacity-100 group-data-[state=open]:pointer-events-auto transition-opacity">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-5 w-5 p-0 text-muted-foreground hover:text-destructive"
                  onClick={(event) => {
                    event.stopPropagation();
                    void handleDiscard();
                  }}
                  title="放弃草稿"
                >
                  <X className="w-3 h-3" />
                </Button>
              </span>
            </div>
          </div>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent onCloseAutoFocus={(event) => event.preventDefault()}>
        <ContextMenuItem className="text-destructive" onClick={() => void handleDiscard()}>
          放弃草稿
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
