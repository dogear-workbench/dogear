import { Extension, type Editor } from '@tiptap/core';
import { DOMParser as ProseMirrorDOMParser } from '@tiptap/pm/model';
import { Plugin } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';

type MarkdownParser = { parse: (text: string, options?: { inline?: boolean }) => string };

export const getMarkdownParser = (editor: Editor): MarkdownParser | undefined =>
  (editor.storage as unknown as { markdown?: { parser?: MarkdownParser } }).markdown?.parser;

const elementFromString = (value: string): HTMLElement =>
  new DOMParser().parseFromString(`<body>${value}</body>`, 'text/html').body;

const RICH_TEXT_SELECTOR = 'p, h1, h2, h3, h4, h5, h6, table, img, a, strong, em, ul, ol, blockquote';

const looksLikeCodeEditorHtml = (html: string): boolean => {
  const body = elementFromString(html);
  if (body.querySelector(RICH_TEXT_SELECTOR)) return false;
  if (body.querySelector('pre, code')) return true;
  return Array.from(body.querySelectorAll('span')).some((el) => /color/i.test(el.getAttribute('style') ?? ''));
};

const looksLikeMarkdown = (text: string): boolean =>
  /^#{1,6} \S/m.test(text) ||
  /\*\*[^*\n]+\*\*/.test(text) ||
  /^[-*+] \[[ xX]\] /m.test(text) ||
  /^(\*|-|\+|\d+\.) /m.test(text) ||
  /^```/m.test(text) ||
  /^> /m.test(text);

export const MarkdownPasteGuard = Extension.create({
  name: 'markdownPasteGuard',
  addProseMirrorPlugins() {
    const editor = this.editor;
    return [
      new Plugin({
        props: {
          handlePaste: (view: EditorView, event: ClipboardEvent) => {
            const { clipboardData } = event;
            if (!clipboardData) return false;
            const text = clipboardData.getData('text/plain');
            const html = clipboardData.getData('text/html');
            if (!text || !html) return false;
            if (!looksLikeCodeEditorHtml(html) || !looksLikeMarkdown(text)) return false;
            const parser = getMarkdownParser(editor);
            if (!parser) return false;
            event.preventDefault();
            const parsedHtml = parser.parse(text, { inline: true });
            const slice = ProseMirrorDOMParser.fromSchema(editor.schema).parseSlice(
              elementFromString(parsedHtml),
              { preserveWhitespace: true },
            );
            view.dispatch(view.state.tr.replaceSelection(slice));
            return true;
          },
        },
      }),
    ];
  },
});
