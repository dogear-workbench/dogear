import { useEffect, useState } from 'react';
import type { Editor } from '@tiptap/react';
import { createPortal } from 'react-dom';

interface TableToolbarProps {
  editor: Editor;
}

type Chain = ReturnType<Editor['chain']>;

const ACTIONS: { label: string; title: string; run: (chain: Chain) => unknown }[] = [
  { label: '删表', title: '删除表格', run: (chain) => chain.deleteTable().run() },
  { label: '删行', title: '删除行', run: (chain) => chain.deleteRow().run() },
  { label: '删列', title: '删除列', run: (chain) => chain.deleteColumn().run() },
  { label: '上插行', title: '上方插入行', run: (chain) => chain.addRowBefore().run() },
  { label: '左插列', title: '左侧插入列', run: (chain) => chain.addColumnBefore().run() },
];

export function TableToolbar({ editor }: TableToolbarProps) {
  const [visible, setVisible] = useState(false);
  const [box, setBox] = useState({ top: 0, left: 0 });

  useEffect(() => {
    const update = () => {
      if (editor.isDestroyed || !editor.isActive('table')) {
        setVisible(false);
        return;
      }
      const $from = editor.state.selection.$from;
      let depth = $from.depth;
      while (depth > 0 && $from.node(depth).type.name !== 'table') depth -= 1;
      if (depth === 0) {
        setVisible(false);
        return;
      }
      const dom = editor.view.nodeDOM($from.before(depth));
      const container = editor.view.dom.parentElement;
      if (!(dom instanceof HTMLElement) || !container) {
        setVisible(false);
        return;
      }
      const tableRect = dom.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();
      setBox((prev) => {
        const top = tableRect.top - containerRect.top;
        const left = tableRect.left - containerRect.left;
        return prev.top === top && prev.left === left ? prev : { top, left };
      });
      setVisible(true);
    };
    editor.on('selectionUpdate', update);
    editor.on('transaction', update);
    return () => {
      editor.off('selectionUpdate', update);
      editor.off('transaction', update);
    };
  }, [editor]);

  const container = editor.view.dom.parentElement;
  if (!container) return null;

  return createPortal(
    <div
      className="notes-table-toolbar notes-bubble"
      data-visible={visible}
      style={{ top: box.top, left: box.left }}
    >
      {ACTIONS.map((action) => (
        <button
          key={action.label}
          type="button"
          title={action.title}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => action.run(editor.chain().focus())}
        >
          {action.label}
        </button>
      ))}
    </div>,
    container,
  );
}
