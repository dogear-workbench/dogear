import type { Editor, Range } from '@tiptap/core';
import {
  CheckSquare,
  Code,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  Minus,
  Quote,
  Table,
  type LucideIcon,
} from 'lucide-react';

export interface SlashMenuItem {
  id: string;
  title: string;
  keywords: string[];
  icon: LucideIcon;
  command: (props: { editor: Editor; range: Range }) => void;
}

type CommandArgs = { editor: Editor; range: Range };

export const SLASH_ITEMS: SlashMenuItem[] = [
  {
    id: 'task',
    title: '待办',
    keywords: ['daiban', 'todo', 'db', 'renwu', 'check'],
    icon: CheckSquare,
    command: ({ editor, range }: CommandArgs) =>
      editor.chain().focus().deleteRange(range).toggleTaskList().run(),
  },
  {
    id: 'heading',
    title: '标题',
    keywords: ['biaoti', 'h2', 'heading', 'bt'],
    icon: Heading2,
    command: ({ editor, range }: CommandArgs) =>
      editor.chain().focus().deleteRange(range).toggleHeading({ level: 2 }).run(),
  },
  {
    id: 'subheading',
    title: '小标题',
    keywords: ['xiaobiaoti', 'h3', 'xbt'],
    icon: Heading3,
    command: ({ editor, range }: CommandArgs) =>
      editor.chain().focus().deleteRange(range).toggleHeading({ level: 3 }).run(),
  },
  {
    id: 'bulletList',
    title: '无序列表',
    keywords: ['wuxu', 'list', 'ul', 'lb'],
    icon: List,
    command: ({ editor, range }: CommandArgs) =>
      editor.chain().focus().deleteRange(range).toggleBulletList().run(),
  },
  {
    id: 'orderedList',
    title: '有序列表',
    keywords: ['youxu', 'ol', 'yx'],
    icon: ListOrdered,
    command: ({ editor, range }: CommandArgs) =>
      editor.chain().focus().deleteRange(range).toggleOrderedList().run(),
  },
  {
    id: 'quote',
    title: '引用',
    keywords: ['yinyong', 'quote', 'yy'],
    icon: Quote,
    command: ({ editor, range }: CommandArgs) =>
      editor.chain().focus().deleteRange(range).toggleBlockquote().run(),
  },
  {
    id: 'codeBlock',
    title: '代码块',
    keywords: ['daima', 'code', 'dm'],
    icon: Code,
    command: ({ editor, range }: CommandArgs) =>
      editor.chain().focus().deleteRange(range).toggleCodeBlock().run(),
  },
  {
    id: 'divider',
    title: '分割线',
    keywords: ['fengexian', 'fgx', 'hr', 'line'],
    icon: Minus,
    command: ({ editor, range }: CommandArgs) =>
      editor.chain().focus().deleteRange(range).setHorizontalRule().run(),
  },
  {
    id: 'table',
    title: '表格',
    keywords: ['biaoge', 'bg', 'table'],
    icon: Table,
    command: ({ editor, range }: CommandArgs) =>
      editor.chain().focus().deleteRange(range).insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
  },
];

export function filterSlashItems(query: string): SlashMenuItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return SLASH_ITEMS;
  return SLASH_ITEMS.filter(
    (item) => item.title.includes(q) || item.keywords.some((k) => k.includes(q)),
  );
}
