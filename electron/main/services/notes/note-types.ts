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

/** 来源身份证：仅 Agent 存卡时写入，记录诞生会话（用户手记不记） */
export interface NoteSource {
  /** 来源对话 ID（tab 主键，failover 不漂移；agent sessionId 会随重启更换，不做跳回 key） */
  conversationId: string;
  /** 落卡时会话标题快照 */
  title: string;
  /** 落卡时间 ISO */
  date: string;
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
  source?: NoteSource;
}

export interface Note extends NoteMeta {
  content: string;
}


