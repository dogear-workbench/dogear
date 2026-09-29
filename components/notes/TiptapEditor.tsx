import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import { TaskList, TaskItem } from '@tiptap/extension-list';
import { TableKit } from '@tiptap/extension-table';
import { Image } from '@tiptap/extension-image';
import { Placeholder } from '@tiptap/extensions';
import { Markdown, type MarkdownStorage } from 'tiptap-markdown';
import { SlashMenu } from '@/components/notes/tiptap/SlashMenu';
import { BubbleToolbar } from '@/components/notes/tiptap/BubbleToolbar';
import { MarkdownPasteGuard } from '@/components/notes/tiptap/markdown-paste-guard';
import { TableToolbar } from '@/components/notes/tiptap/TableToolbar';
import { NotePathLink, getDecoratedPathAt, getLinkHrefAt } from '@/components/notes/tiptap/note-path-link';
import { useMarkdownPreviewStore } from '@/stores/markdown-preview-store';
import { client } from '@/lib/client';
import { toast } from 'sonner';

interface TiptapEditorProps {
  initialMarkdown: string;
  onChange: (md: string) => void;
  /** 编辑器实例创建后回调（供外部 focus / 读文档状态） */
  onReady?: (editor: Editor) => void;
  /** 正文路径点击：.md 应用内预览用 */
  workspaceId: string;
  /** 正文路径点击：其他后缀拼绝对路径给系统打开用 */
  workspacePath: string;
}

const getMarkdown = (editor: Editor): string =>
  (editor.storage as unknown as { markdown: MarkdownStorage }).markdown.getMarkdown();

// 父组件以 key={noteId} 挂载：编辑器生命周期 = 挂载周期，无外部内容同步需求
export function TiptapEditor({ initialMarkdown, onChange, onReady, workspaceId, workspacePath }: TiptapEditorProps) {
  /** 点击路径分流：.md → 应用内预览；其他后缀 → 系统打开；http(s) → 外部浏览器 */
  const handlePathClick = (rawPath: string) => {
    const path = rawPath.trim();
    if (/^https?:\/\//i.test(path)) {
      window.open(path, '_blank', 'noopener,noreferrer');
      return;
    }
    if (path.toLowerCase().endsWith('.md')) {
      const fileName = path.split('/').pop() ?? path;
      useMarkdownPreviewStore.getState().open(workspaceId, path, fileName);
      return;
    }
    const absolute = workspacePath ? `${workspacePath.replace(/[\\/]+$/, '')}/${path}` : path;
    void client
      .openFileInFolder({ filePath: absolute })
      .then((result) => {
        if (!result?.success) toast.error('打开文件失败', { description: result?.error || path });
      })
      .catch((error) => {
        console.error('[notes] openFileInFolder 失败:', error);
        toast.error('打开文件失败', { description: path });
      });
  };

  const editor = useEditor({
    content: initialMarkdown,
    extensions: [
      StarterKit,
      Link.configure({
        openOnClick: false,
        autolink: false,
        defaultProtocol: 'https',
      }),
      TaskList,
      TaskItem.configure({ nested: true }),
      TableKit.configure({ table: { resizable: true } }),
      Image,
      Placeholder.configure({ placeholder: '输入 # 变标题、/ 插入块、- [ ] 加待办…' }),
      Markdown.configure({
        html: true,
        transformPastedText: true,
        transformCopiedText: true,
      }),
      SlashMenu,
      MarkdownPasteGuard,
      NotePathLink,
    ],
    editorProps: {
      attributes: {
        class: 'notes-prose prose dark:prose-invert max-w-none min-h-72 px-4 py-3 focus:outline-none',
      },
      handleClick: (view, pos) => {
        // 显式 markdown 链接优先；其次路径高亮 Decoration
        const href = getLinkHrefAt(view.state, pos);
        if (href) {
          handlePathClick(href);
          return true;
        }
        const decorated = getDecoratedPathAt(view.state, pos);
        if (decorated) {
          handlePathClick(decorated);
          return true;
        }
        return false;
      },
    },
    onUpdate: ({ editor }) => onChange(getMarkdown(editor)),
    onCreate: ({ editor }) => onReady?.(editor),
  });

  return (
    <div className="relative">
      <EditorContent editor={editor} className="notes-editor" />
      {editor && <TableToolbar editor={editor} />}
      {editor && <BubbleToolbar editor={editor} />}
    </div>
  );
}
