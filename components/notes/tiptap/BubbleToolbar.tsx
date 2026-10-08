import { useRef, useState } from 'react';
import type { Editor } from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';
import { Bold, Code, Italic, Link2, RemoveFormatting, Strikethrough, WandSparkles, X } from 'lucide-react';
import { getMarkdownParser } from './markdown-paste-guard';
export function BubbleToolbar({ editor }: { editor: Editor }) {
  const [linkOpen, setLinkOpen] = useState(false);
  const [href, setHref] = useState('');
  const linkOpenRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const setLinkEditing = (open: boolean) => {
    linkOpenRef.current = open;
    setLinkOpen(open);
    if (open) window.setTimeout(() => inputRef.current?.select(), 0);
  };

  const openLinkEditor = () => {
    setHref((editor.getAttributes('link').href as string | undefined) ?? '');
    setLinkEditing(true);
  };

  const applyLink = () => {
    const url = href.trim();
    if (url) {
      editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
    } else {
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
    }
    setLinkEditing(false);
  };

  const removeLink = () => {
    editor.chain().focus().extendMarkRange('link').unsetLink().run();
    setLinkEditing(false);
  };

  const blurInput = () => {
    window.setTimeout(() => {
      if (!linkOpenRef.current) return;
      const active = document.activeElement;
      if (active !== inputRef.current && !(active instanceof HTMLElement && active.closest('.notes-bubble'))) {
        setLinkEditing(false);
      }
    }, 0);
  };

  const toggleMark = (fn: (chain: ReturnType<Editor['chain']>) => unknown) => () => {
    fn(editor.chain().focus());
  };

  const renderAsMarkdown = () => {
    const { from, to } = editor.state.selection;
    if (from === to) return;
    const parser = getMarkdownParser(editor);
    if (!parser) return;
    const text = editor.state.doc.textBetween(from, to, '\n');
    const html = parser.parse(text, { inline: true });
    editor.chain().focus().insertContentAt({ from, to }, html).run();
  };

  const clearFormatting = () => {
    editor.chain().focus().clearNodes().unsetAllMarks().run();
  };

  return (
    <BubbleMenu
      editor={editor}
      updateDelay={100}
      options={{ placement: 'top', offset: 8 }}
      shouldShow={({ state }) => !state.selection.empty || linkOpenRef.current}
      className="notes-bubble"
    >
      {linkOpen ? (
        <div className="notes-bubble-linkrow">
          <input
            ref={inputRef}
            value={href}
            onChange={(e) => setHref(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                e.stopPropagation();
                applyLink();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                setLinkEditing(false);
              }
            }}
            onBlur={blurInput}
            placeholder="链接地址，回车确认"
          />
          {editor.isActive('link') && (
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={removeLink}
              title="移除链接"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      ) : (
        <>
          <button
            type="button"
            data-active={editor.isActive('bold')}
            onClick={toggleMark((chain) => chain.toggleBold().run())}
            title="粗体"
          >
            <Bold className="w-4 h-4" />
          </button>
          <button
            type="button"
            data-active={editor.isActive('italic')}
            onClick={toggleMark((chain) => chain.toggleItalic().run())}
            title="斜体"
          >
            <Italic className="w-4 h-4" />
          </button>
          <button
            type="button"
            data-active={editor.isActive('code')}
            onClick={toggleMark((chain) => chain.toggleCode().run())}
            title="行内代码"
          >
            <Code className="w-4 h-4" />
          </button>
          <button
            type="button"
            data-active={editor.isActive('strike')}
            onClick={toggleMark((chain) => chain.toggleStrike().run())}
            title="删除线"
          >
            <Strikethrough className="w-4 h-4" />
          </button>
          <button
            type="button"
            data-active={editor.isActive('link')}
            onClick={openLinkEditor}
            title="链接"
          >
            <Link2 className="w-4 h-4" />
          </button>
          <span className="notes-bubble-sep" />
          <button type="button" onClick={renderAsMarkdown} title="按 Markdown 渲染">
            <WandSparkles className="w-4 h-4" />
          </button>
          <button type="button" onClick={clearFormatting} title="清除格式">
            <RemoveFormatting className="w-4 h-4" />
          </button>
        </>
      )}
    </BubbleMenu>
  );
}
