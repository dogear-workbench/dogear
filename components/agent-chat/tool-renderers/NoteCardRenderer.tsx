import { useEffect, useReducer } from 'react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { client } from '@/lib/client';
import { rendererEvents } from '@/lib/events';
import { useSessionStore, NOTES_TAB_ID } from '@/stores/session-store';
import { useNotesStore } from '@/stores/notes-store';
import { useWorkspaceId } from '../workspace-id-context';
import { useWorkspacePath } from '../path-link';
import { ToolDetailShell, ToolSection, KeyValueList, OutputBox, ChipList } from './ToolDetailShell';

interface Props {
  toolInput?: Record<string, any>;
  toolOutput?: any;
  isError?: boolean;
}

function toOutputText(toolOutput: any): string {
  if (typeof toolOutput === 'string') return toolOutput;
  return toolOutput != null ? JSON.stringify(toolOutput, null, 2) : '';
}

function extractTitle(content: string): string {
  return content.split('\n')[0]?.replace(/^#{1,6}\s*/, '').trim() ?? '';
}

function toLinks(links: any): string[] {
  return Array.isArray(links) ? links.filter((l: any) => typeof l === 'string') : [];
}

// noteId → title；null = 确认不存在（已删卡），避免重复请求
const noteTitleCache = new Map<string, string | null>();

function useNoteTitle(noteId: string, workspacePath: string | null): string | null | undefined {
  const notes = useNotesStore((s) => s.notes);
  const [, bump] = useReducer((n: number) => n + 1, 0);

  useEffect(() => {
    const unsub = rendererEvents.notesChanged.listen(() => {
      noteTitleCache.clear();
      bump();
    });
    return () => unsub();
  }, [bump]);

  useEffect(() => {
    if (!noteId || noteTitleCache.has(noteId)) return;
    const cached = notes.find((n) => n.id === noteId);
    if (cached) {
      noteTitleCache.set(noteId, cached.title);
      bump();
      return;
    }
    if (!workspacePath) return;
    let cancelled = false;
    void client
      .getNote({ workspacePath, noteId })
      .catch(() => null)
      .then((result) => {
        const title = result && 'note' in result && result.note ? result.note.title : null;
        if (!cancelled) noteTitleCache.set(noteId, title);
      })
      .finally(() => {
        if (!cancelled) bump();
      });
    return () => {
      cancelled = true;
    };
  }, [noteId, notes, workspacePath, bump]);

  if (!noteId) return null;
  return noteTitleCache.get(noteId);
}

function openNoteCard(noteId: string, workspacePath: string | null) {
  if (!workspacePath) return;
  void (async () => {
    const result = await client.getNote({ workspacePath, noteId }).catch(() => null);
    if (!result || !('note' in result) || !result.note) {
      toast.warning('卡片不存在或已删除');
      return;
    }
    useSessionStore.getState().switchTab(NOTES_TAB_ID);
    useNotesStore.getState().setActiveNoteId(noteId);
  })();
}

function NoteLinkRow({ noteId }: { noteId: string }) {
  const workspaceId = useWorkspaceId();
  const workspacePath = useWorkspacePath(workspaceId);
  const title = useNoteTitle(noteId, workspacePath);
  const missing = title === null;
  return (
    <button
      type="button"
      title={missing ? '卡片不存在或已删除' : '打开卡片'}
      onClick={() => openNoteCard(noteId, workspacePath)}
      className="flex gap-2 items-baseline w-full text-left group/note"
    >
      <span className="text-muted-foreground font-mono shrink-0">卡片</span>
      <span
        className={cn(
          'font-mono break-all min-w-0 flex-1 transition-colors',
          missing ? 'text-muted-foreground' : 'group-hover/note:text-sky-600 dark:group-hover/note:text-sky-400',
        )}
      >
        {missing ? `${noteId}（卡片不存在）` : title != null ? `${title}（${noteId.slice(0, 8)}）` : noteId}
      </span>
    </button>
  );
}

function PreviewSection({ label, content }: { label: string; content: string }) {
  return (
    <ToolSection label={label}>
      <div className="whitespace-pre-wrap break-all text-foreground/90 max-h-40 overflow-y-auto bg-muted/30 rounded px-2 py-1.5">
        {content}
      </div>
    </ToolSection>
  );
}

export function NoteCardRenderer({ toolInput, toolOutput, isError }: Props) {
  const outputText = toOutputText(toolOutput);
  const noteId = typeof toolInput?.noteId === 'string' ? toolInput.noteId : '';
  const content = typeof toolInput?.content === 'string' ? toolInput.content : '';
  const patch = toolInput?.patch ?? null;

  const outputSection = outputText ? (
    <ToolSection label={isError ? '错误' : '输出'}>
      <OutputBox content={outputText} isError={isError} maxHeightClass="max-h-32" />
    </ToolSection>
  ) : null;

  if (patch) {
    const patchTags = Array.isArray(patch.tags) ? patch.tags.filter((t: any) => typeof t === 'string') : [];
    const patchLinks = toLinks(patch.links);
    return (
      <ToolDetailShell>
        <ToolSection label="更新卡片">
          <NoteLinkRow noteId={noteId} />
        </ToolSection>
        {typeof patch.content === 'string' && <PreviewSection label="新正文" content={patch.content} />}
        {patchTags.length > 0 && (
          <ToolSection label="标签（整体替换）">
            <ChipList items={patchTags} />
          </ToolSection>
        )}
        {patchLinks.length > 0 && (
          <ToolSection label="引用（整体替换）">
            <KeyValueList data={Object.fromEntries(patchLinks.map((l: string, i: number) => [`${i + 1}`, l]))} />
          </ToolSection>
        )}
        {outputSection}
      </ToolDetailShell>
    );
  }

  if (noteId) {
    return (
      <ToolDetailShell>
        <ToolSection label="追加卡片">
          <NoteLinkRow noteId={noteId} />
        </ToolSection>
        {content && <PreviewSection label="追加片段" content={content} />}
        {outputSection}
      </ToolDetailShell>
    );
  }

  const title = extractTitle(content);
  const body = content.split('\n').slice(1).join('\n').trim();
  const tags = Array.isArray(toolInput?.tags) ? toolInput.tags.filter((t: any) => typeof t === 'string') : [];
  const links = toLinks(toolInput?.links);

  return (
    <ToolDetailShell>
      <ToolSection label="创建卡片">
        <div className="text-foreground font-medium break-all">{title || '（无标题）'}</div>
      </ToolSection>
      {tags.length > 0 && (
        <ToolSection label="标签">
          <ChipList items={tags} />
        </ToolSection>
      )}
      {links.length > 0 && (
        <ToolSection label="引用">
          <KeyValueList data={Object.fromEntries(links.map((l, i) => [`${i + 1}`, l]))} />
        </ToolSection>
      )}
      {body && <PreviewSection label="正文" content={body} />}
      {outputSection}
    </ToolDetailShell>
  );
}
