import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { TaskList, TaskItem } from '@tiptap/extension-list';
import { TableKit } from '@tiptap/extension-table';
import { Image } from '@tiptap/extension-image';
import { Placeholder } from '@tiptap/extensions';
import { Markdown, type MarkdownStorage } from 'tiptap-markdown';
import { SlashMenu } from '@/components/notes/tiptap/SlashMenu';
import { BubbleToolbar } from '@/components/notes/tiptap/BubbleToolbar';

interface TiptapEditorProps {
  initialMarkdown: string;
  onChange: (md: string) => void;
  /** 编辑器实例创建后回调（供外部 focus / 读文档状态） */
  onReady?: (editor: Editor) => void;
}

const getMarkdown = (editor: Editor): string =>
  (editor.storage as unknown as { markdown: MarkdownStorage }).markdown.getMarkdown();

// 父组件以 key={noteId} 挂载：编辑器生命周期 = 挂载周期，无外部内容同步需求
export function TiptapEditor({ initialMarkdown, onChange, onReady }: TiptapEditorProps) {
  const editor = useEditor({
    content: initialMarkdown,
    extensions: [
      StarterKit,
      TaskList,
      TaskItem.configure({ nested: true }),
      TableKit,
      Image,
      Placeholder.configure({ placeholder: '输入 # 变标题、/ 插入块、- [ ] 加待办…' }),
      Markdown.configure({
        html: true,
        transformPastedText: true,
        transformCopiedText: true,
      }),
      SlashMenu,
    ],
    editorProps: {
      attributes: {
        class: 'notes-prose prose dark:prose-invert max-w-none min-h-72 px-4 py-3 focus:outline-none',
      },
    },
    onUpdate: ({ editor }) => onChange(getMarkdown(editor)),
    onCreate: ({ editor }) => onReady?.(editor),
  });

  return (
    <>
      <EditorContent editor={editor} className="notes-editor" />
      {editor && <BubbleToolbar editor={editor} />}
    </>
  );
}
