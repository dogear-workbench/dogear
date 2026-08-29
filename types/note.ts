/**
 * 笔记系统类型定义（前端共享真源，一卡一 md 文件，frontmatter 承载元数据）
 *
 * 主进程侧镜像在 electron/main/services/notes/note-types.ts（tsconfig rootDir 限制），
 * 修改时两边同步。
 */

/** 待办状态；「可实施待办」= 有 plan 字段（数据判定，非文本理解） */
export type TodoStatus = 'pending' | 'in_progress' | 'done';

export interface TodoItem {
  id: string;                    // 卡内唯一标识（精确操作、幂等）
  text: string;                  // 待办内容
  status: TodoStatus;
  plan?: string;                 // 落盘 plan 的相对路径，有值即可领取执行
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

/** 笔记元数据（index.json 缓存 + 回收站列表共用） */
export interface NoteMeta {
  id: string;                    // shortid8（base36），同时是文件名后缀与 frontmatter id
  file: string;                  // 当前所在文件名（含 .md，不含路径）
  title: string;                 // 正文首行 ≤40 字（frontmatter 无标题字段）
  created: string;               // ISO 时间戳
  updated: string;               // ISO 时间戳
  tags: string[];
  links: string[];               // 结构化引用：article:<id> / stock:<code> / plan:<path>
  todos: TodoItem[];
  source?: NoteSource;
}

/** 笔记完整数据（meta + 正文） */
export interface Note extends NoteMeta {
  content: string;               // Markdown 正文，不做结构约定
}

/** 跨卡片待办聚合项（listTodos 返回） */
export interface NoteTodoEntry {
  noteId: string;
  noteTitle: string;
  todo: TodoItem;
}
