import { useEffect, useRef, useState } from 'react';
import {
  MDXEditor,
  type MDXEditorMethods,
  headingsPlugin,
  listsPlugin,
  quotePlugin,
  thematicBreakPlugin,
  linkPlugin,
  linkDialogPlugin,
  markdownShortcutPlugin,
  toolbarPlugin,
  UndoRedo,
  BoldItalicUnderlineToggles,
  BlockTypeSelect,
  ListsToggle,
  CreateLink,
  Separator,
} from '@mdxeditor/editor';
import '@mdxeditor/editor/style.css';
import { useDashboardStore } from '@/stores/dashboard-store';

interface ScratchpadSectionProps {
  workspaceId: string;
}

export function ScratchpadSection({ workspaceId }: ScratchpadSectionProps) {
  const notesContent = useDashboardStore((s) => s.notesContent);
  const notesSaving = useDashboardStore((s) => s.notesSaving);
  const flushNotes = useDashboardStore((s) => s.flushNotes);

  const editorRef = useRef<MDXEditorMethods>(null);
  const [touched, setTouched] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 切工作区或加载完成时，强制把编辑器内容同步到 store
  // （MDXEditor 是非受控的，必须通过 ref 重设）
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    if (editor.getMarkdown() !== notesContent) {
      editor.setMarkdown(notesContent);
    }
    setTouched(false);
  }, [notesContent, workspaceId]);

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    };
  }, []);

  const handleChange = (md: string) => {
    setTouched(true);
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      flushNotes(workspaceId, md);
    }, 800);
  };

  return (
    <section className="flex h-full min-h-0 flex-col gap-2">
      <div className="flex shrink-0 items-center justify-between px-1">
        <h2 className="text-sm font-semibold text-foreground">我的速记</h2>
        {touched && (
          <span className="text-xs text-muted-foreground">
            {notesSaving ? '保存中…' : '已保存'}
          </span>
        )}
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-background">
        <MDXEditor
          ref={editorRef}
          markdown={notesContent}
          onChange={handleChange}
          placeholder="随手记点什么…"
          contentEditableClassName="prose prose-sm max-w-none dark:prose-invert px-4 py-3 min-h-full focus:outline-none"
          className="flex-1 overflow-y-auto"
          plugins={[
            headingsPlugin(),
            listsPlugin(),
            quotePlugin(),
            thematicBreakPlugin(),
            linkPlugin(),
            linkDialogPlugin(),
            markdownShortcutPlugin(),
            toolbarPlugin({
              toolbarClassName: 'border-b border-border bg-muted/30',
              toolbarContents: () => (
                <>
                  <UndoRedo />
                  <Separator />
                  <BoldItalicUnderlineToggles />
                  <Separator />
                  <BlockTypeSelect />
                  <Separator />
                  <ListsToggle />
                  <Separator />
                  <CreateLink />
                </>
              ),
            }),
          ]}
        />
      </div>
    </section>
  );
}
