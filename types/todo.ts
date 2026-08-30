/**
 * 人待办类型定义（前端共享真源，存储 .dogear/todos.json）
 *
 * 主进程侧真源在 electron/main/services/todo-service.ts（tsconfig rootDir 限制），
 * 修改时两边同步。
 */

export type HumanTodoStatus = 'pending' | 'done';

export type HumanTodoSource = 'manual' | 'agent';

export interface HumanTodo {
  id: string;
  text: string;
  status: HumanTodoStatus;
  /** ISO 日期，可选；排序用，不做系统通知 */
  due?: string;
  /** 双链笔记 ID */
  noteId?: string;
  source: HumanTodoSource;
  createdAt: string;
  updatedAt: string;
  /** 软删除 → 回收站 */
  deletedAt?: string;
}
