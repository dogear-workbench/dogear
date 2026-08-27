/**
 * 笔记类型（主进程侧）
 *
 * 与 types/note.ts 保持一字不差：tsconfig.electron.json rootDir 限制，
 * 主进程不能直接引根目录 types/，参照 article-service ↔ types/article.ts 的镜像惯例。
 * 修改时两边同步。
 */

export type TodoStatus = 'pending' | 'in_progress' | 'done';

export interface TodoItem {
  id: string;
  text: string;
  status: TodoStatus;
  plan?: string;
}

export interface NoteMeta {
  id: string;
  file: string;
  title: string;
  created: string;
  updated: string;
  tags: string[];
  links: string[];
  todos: TodoItem[];
}

export interface Note extends NoteMeta {
  content: string;
}

export interface NoteTodoEntry {
  noteId: string;
  noteTitle: string;
  todo: TodoItem;
}
