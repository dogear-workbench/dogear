import Database from 'better-sqlite3';
import type BetterSqlite3 from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { v4 as uuidv4 } from 'uuid';

// 获取当前文件的路径和目录名(ES Module 环境)
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * 书籍数据接口
 * 定义书籍对象的数据结构
 */
export interface Book {
  id?: string;                           // 书籍唯一标识(UUID)
  title: string;                         // 书名 (NOT NULL)
  author: string | null;                 // 作者
  file_type: string;                     // 文件类型(txt/epub/pdf) (NOT NULL)

  // 预处理状态
  processing_status: 'pending' | 'processing' | 'completed' | 'failed';  // 处理状态 (NOT NULL)
  processing_progress: number;           // 处理进度 0-100 (默认值: 0)

  // 阅读进度(基于章节)
  current_chapter_id: string | null;     // 当前阅读的章节ID(UUID)

  // 统计信息
  total_chapters: number;                // 总章节数 (默认值: 0)
  total_characters: number;              // 总字符数 (默认值: 0)

  // 原始文件信息
  original_file_path: string | null;     // 原始文件路径
  file_size: number | null;              // 文件大小(字节)

  // 工作区相关 (v2 新增)
  workspace_id?: string;                 // 工作区ID (默认值: 'default')
  file_path?: string;                    // 工作区内的文件路径(相对于工作区)

  // AI 分析状态 (v2 新增)
  analysis_status?: 'none' | 'analyzing' | 'analyzed' | 'failed';  // 分析状态
  analyzed_at?: number | null;           // 最后分析时间戳

  cover_image: string | null;            // 封面图片路径
  metadata: string | null;               // 其他元数据(JSON 格式)
  created_at?: string;                   // 创建时间（数据库自动生成）
  updated_at?: string;                   // 更新时间（数据库自动生成）
}

/**
 * 章节数据接口
 */
export interface Chapter {
  id?: string;                      // 章节唯一标识(UUID)
  book_id: string;                  // 关联的书籍ID(UUID)
  chapter_index: number;            // 章节序号
  title: string;                    // 章节标题
  content: string;                  // 章节完整内容
  character_count: number;          // 字符数
  preview_text: string;             // 预览文本
  created_at?: string;              // 创建时间
}

/**
 * 章节元数据接口(不含 content,用于列表展示)
 */
export interface ChapterMetadata {
  id: string;                       // 章节唯一标识(UUID)
  book_id: string;                  // 关联的书籍ID(UUID)
  chapter_index: number;            // 章节序号
  title: string;                    // 章节标题
  character_count: number;          // 字符数
  preview_text: string;             // 预览文本
}

/**
 * AI 交互记录接口
 * 定义 AI 交互记录的数据结构
 */
export interface AIInteraction {
  id?: string;                       // 交互记录唯一标识(UUID)
  book_id: string | null;            // 关联的书籍 ID(UUID)
  type: 'chat' | 'summarize' | 'qna';  // 交互类型
  user_message: string | null;       // 用户的消息
  ai_response: string;               // AI 的回复
  context_text: string | null;       // 上下文文本
  model_info: string | null;         // 模型信息
  created_at?: string;               // 交互时间（数据库自动生成）
}

/**
 * 工作区接口 (v2 新增)
 * 定义工作区的数据结构
 */
export interface Workspace {
  id: string;                        // 工作区ID
  name: string;                      // 工作区名称
  path: string;                      // 工作区绝对路径
  is_default: number;                // 是否为默认工作区 (0 或 1)
  created_at: number;                // 创建时间戳
}

/**
 * 对话接口 (v3 新增)
 * 定义对话会话的数据结构
 */
export interface Conversation {
  id: string;                        // 对话唯一标识(UUID)
  book_id: string;                   // 关联的书籍ID(UUID)
  title: string;                     // 对话标题
  model: string;                     // 使用的模型
  sdk_session_id?: string;           // SDK 返回的 session_id（用于 resume 功能）
  parent_conversation_id?: string;   // 父对话ID（分叉对话时使用）
  fork_message_sdk_uuid?: string;    // 分叉点的 assistant 消息 SDK UUID
  created_at: number;                // 创建时间戳
  updated_at: number;                // 最后更新时间戳
}

/**
 * 对话消息接口 (v3 新增)
 * 定义对话消息的数据结构
 */
export interface ConversationMessage {
  id: string;                        // 消息唯一标识(UUID)
  conversation_id: string;           // 关联的对话ID(UUID)
  role: 'user' | 'assistant' | 'system';  // 角色
  content: string;                   // 消息内容
  content_blocks?: string;           // 扩展内容块（JSON格式）
  sdk_uuid?: string;                 // SDK 消息 UUID（用于分叉定位）
  timestamp: number;                 // 消息时间戳
}

/**
 * 对话分支接口 (v4 新增)
 * 用于编辑重发时的分支版本管理
 */
export interface ConversationBranch {
  id: string;                        // 分支唯一标识(UUID)
  conversation_id: string;           // 所属对话ID
  fork_point_sdk_uuid: string;       // 分叉点的 assistant 消息 SDK UUID
  branch_index: number;              // 分支序号 (0=原始)
  sdk_session_id: string;            // 此分支的 SDK session ID
  created_at: number;                // 创建时间戳
}

/**
 * 分支消息接口 (v4 新增)
 * 存储分支中的消息
 */
export interface BranchMessage {
  id: string;                        // 消息唯一标识(UUID)
  branch_id: string;                 // 所属分支ID
  conversation_id: string;           // 所属对话ID（冗余，方便查询）
  role: 'user' | 'assistant' | 'system';
  content: string;
  content_blocks?: string;
  sdk_uuid?: string;
  timestamp: number;
}

// ==================== 数据库初始化 ====================

// 数据库实例(延迟初始化)
let db: BetterSqlite3.Database | null = null;

/**
 * 初始化数据库
 * @param dbPath - 数据库文件路径(可选,默认使用应用安装目录下的 data/dogear.db)
 */
export async function initDatabase(dbPath?: string): Promise<BetterSqlite3.Database> {
  if (db) {
    return db;
  }

  // 如果没有提供路径,使用项目根目录下的 data 文件夹
  if (!dbPath) {
    // 从当前文件位置向上找到项目根目录 (database 目录 -> main 目录 -> electron 目录 -> 项目根目录)
    const projectRoot = path.resolve(__dirname, '../../../');
    const dbDir = path.join(projectRoot, 'data');

    // 确保 data 目录存在
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }

    dbPath = path.join(dbDir, 'dogear.db');
  }

  // 读取数据库 schema 定义文件
  const schemaPath = path.join(__dirname, 'schema.sql');
  const schema = fs.readFileSync(schemaPath, 'utf-8');

  // 创建数据库连接
  db = new Database(dbPath);

  // 执行 schema,创建表和索引
  db.exec(schema);

  // ==================== v4 迁移：分叉和分支支持 ====================
  // 给 conversations 表添加分叉字段
  try { db.exec(`ALTER TABLE conversations ADD COLUMN parent_conversation_id TEXT`); } catch { /* 列已存在 */ }
  try { db.exec(`ALTER TABLE conversations ADD COLUMN fork_message_sdk_uuid TEXT`); } catch { /* 列已存在 */ }
  // 给 conversation_messages 表添加 sdk_uuid 字段
  try { db.exec(`ALTER TABLE conversation_messages ADD COLUMN sdk_uuid TEXT`); } catch { /* 列已存在 */ }

  // 创建分支表
  db.exec(`
    CREATE TABLE IF NOT EXISTS conversation_branches (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      fork_point_sdk_uuid TEXT NOT NULL,
      branch_index INTEGER NOT NULL DEFAULT 0,
      sdk_session_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_branches_conversation_id ON conversation_branches(conversation_id);
    CREATE INDEX IF NOT EXISTS idx_branches_fork_point ON conversation_branches(conversation_id, fork_point_sdk_uuid);
  `);

  // 创建分支消息表
  db.exec(`
    CREATE TABLE IF NOT EXISTS branch_messages (
      id TEXT PRIMARY KEY,
      branch_id TEXT NOT NULL,
      conversation_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      content_blocks TEXT,
      sdk_uuid TEXT,
      timestamp INTEGER NOT NULL,
      FOREIGN KEY (branch_id) REFERENCES conversation_branches(id) ON DELETE CASCADE,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_branch_messages_branch_id ON branch_messages(branch_id);
    CREATE INDEX IF NOT EXISTS idx_branch_messages_timestamp ON branch_messages(timestamp);
  `);

  return db;
}

/**
 * 获取数据库实例
 * @throws 如果数据库未初始化则抛出错误
 */
function getDb(): BetterSqlite3.Database {
  if (!db) {
    throw new Error('数据库未初始化,请先调用 initDatabase()');
  }
  return db;
}

// ==================== 书籍操作 ====================

/**
 * 书籍数据库操作集合
 * 提供对书籍表的 CRUD 操作
 */
export const dbBooks = {
  /**
   * 获取所有书籍列表
   * @returns 返回按创建时间倒序排列的书籍数组
   */
  getAll: (): Book[] => {
    const stmt = getDb().prepare('SELECT * FROM books ORDER BY created_at DESC');
    return stmt.all() as Book[];
  },

  /**
   * 根据 ID 获取单本书籍
   * @param id - 书籍 ID (UUID)
   * @returns 返回书籍对象,如果不存在则返回 undefined
   */
  getById: (id: string): Book | undefined => {
    const stmt = getDb().prepare('SELECT * FROM books WHERE id = ?');
    return stmt.get(id) as Book | undefined;
  },

  /**
   * 添加新书籍
   * @param book - 书籍对象
   * @returns 返回新插入记录的 ID (UUID)
   */
  add: (book: Book): string => {
    // 生成新的 UUID
    const newId = uuidv4();

    const stmt = getDb().prepare(`
      INSERT INTO books (
        id, title, author, file_type,
        processing_status, processing_progress,
        current_chapter_id,
        total_chapters, total_characters,
        original_file_path, file_size,
        workspace_id, file_path,
        cover_image, metadata
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      newId,
      book.title,
      book.author,  // 已经是 string | null，不需要 ||
      book.file_type,
      book.processing_status,  // 已经是必需字段，不需要默认值
      book.processing_progress,  // 已经是必需字段，不需要默认值
      book.current_chapter_id,  // 已经是 string | null，不需要 ||
      book.total_chapters,  // 已经是必需字段，不需要默认值
      book.total_characters,  // 已经是必需字段，不需要默认值
      book.original_file_path,  // 已经是 string | null，不需要 ||
      book.file_size,  // 已经是 number | null，不需要 ||
      book.workspace_id || 'default',  // workspace_id，默认为 'default'
      book.file_path || null,  // file_path，可为 null
      book.cover_image,  // 已经是 string | null，不需要 ||
      book.metadata  // 已经是 string | null，不需要 ||
    );
    return newId;
  },

  /**
   * 更新书籍信息
   * @param id - 书籍 ID (UUID)
   * @param book - 包含更新字段的对象
   */
  update: (id: string, book: Partial<Book>): void => {
    // 动态构建 SET 子句,只更新提供的字段
    const fields = Object.keys(book)
      .filter(k => k !== 'id' && k !== 'created_at')  // 排除不能更新的字段
      .map(k => `${k} = ?`)
      .join(', ');

    // 提取对应的值
    const values = Object.entries(book)
      .filter(([k]) => k !== 'id' && k !== 'created_at')
      .map(([, v]) => v);

    // 执行更新,自动更新 updated_at 字段
    const stmt = getDb().prepare(`UPDATE books SET ${fields}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`);
    stmt.run(...values, id);
  },

  /**
   * 删除书籍
   * 由于外键级联约束,相关联的 AI 交互记录也会被删除
   * @param id - 书籍 ID (UUID)
   */
  delete: (id: string): void => {
    const stmt = getDb().prepare('DELETE FROM books WHERE id = ?');
    stmt.run(id);
  }
};

// ==================== 章节操作 ====================

/**
 * 章节数据库操作集合
 * 提供对章节表的 CRUD 操作
 */
export const dbChapters = {
  /**
   * 获取书籍的章节元数据列表(不含 content,用于目录导航)
   * @param bookId - 书籍ID (UUID)
   * @returns 返回按章节序号排序的章节元数据数组
   */
  getChapterMetadata: (bookId: string): ChapterMetadata[] => {
    const stmt = getDb().prepare(`
      SELECT id, book_id, chapter_index, title, character_count, preview_text
      FROM chapters
      WHERE book_id = ?
      ORDER BY chapter_index
    `);
    return stmt.all(bookId) as ChapterMetadata[];
  },

  /**
   * 根据ID获取单个章节(完整内容)
   * @param chapterId - 章节ID (UUID)
   * @returns 返回完整章节对象,包含 content
   */
  getById: (chapterId: string): Chapter | undefined => {
    const stmt = getDb().prepare('SELECT * FROM chapters WHERE id = ?');
    return stmt.get(chapterId) as Chapter | undefined;
  },

  /**
   * 根据章节序号获取章节(完整内容)
   * @param bookId - 书籍ID (UUID)
   * @param chapterIndex - 章节序号
   * @returns 返回完整章节对象,包含 content
   */
  getByIndex: (bookId: string, chapterIndex: number): Chapter | undefined => {
    const stmt = getDb().prepare(
      'SELECT * FROM chapters WHERE book_id = ? AND chapter_index = ?'
    );
    return stmt.get(bookId, chapterIndex) as Chapter | undefined;
  },

  /**
   * 批量插入章节
   * @param chapters - 章节数组(不含 id)
   */
  bulkInsert: (chapters: Omit<Chapter, 'id' | 'created_at'>[]): void => {
    const insert = getDb().prepare(`
      INSERT INTO chapters (id, book_id, chapter_index, title, content, character_count, preview_text)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    const transaction = getDb().transaction((chapters: Omit<Chapter, 'id' | 'created_at'>[]) => {
      for (const chapter of chapters) {
        const newId = uuidv4(); // 为每个章节生成 UUID
        insert.run(
          newId,
          chapter.book_id,
          chapter.chapter_index,
          chapter.title,
          chapter.content,
          chapter.character_count,
          chapter.preview_text
        );
      }
    });

    transaction(chapters);
  },

  /**
   * 删除书籍的所有章节
   * @param bookId - 书籍ID (UUID)
   */
  deleteByBookId: (bookId: string): void => {
    const stmt = getDb().prepare('DELETE FROM chapters WHERE book_id = ?');
    stmt.run(bookId);
  }
};

// ==================== AI 交互操作 ====================

/**
 * AI 交互数据库操作集合
 * 提供对 AI 交互记录的 CRUD 操作
 */
export const dbAI = {
  /**
   * 获取指定书籍的所有 AI 交互记录
   * @param bookId - 书籍 ID (UUID)
   * @returns 返回按创建时间倒序排列的交互记录数组
   */
  getByBookId: (bookId: string): AIInteraction[] => {
    const stmt = getDb().prepare('SELECT * FROM ai_interactions WHERE book_id = ? ORDER BY created_at DESC');
    return stmt.all(bookId) as AIInteraction[];
  },

  /**
   * 添加新的 AI 交互记录
   * @param interaction - AI 交互对象
   * @returns 返回新插入记录的 ID (UUID)
   */
  add: (interaction: AIInteraction): string => {
    const newId = uuidv4();

    const stmt = getDb().prepare(`
      INSERT INTO ai_interactions (id, book_id, type, user_message, ai_response, context_text, model_info)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      newId,
      interaction.book_id,  // 已经是 string | null，不需要 ||
      interaction.type,
      interaction.user_message,  // 已经是 string | null，不需要 ||
      interaction.ai_response,
      interaction.context_text,  // 已经是 string | null，不需要 ||
      interaction.model_info  // 已经是 string | null，不需要 ||
    );
    return newId;
  }
};

// ==================== 工作区操作 (v2 新增) ====================

/**
 * 工作区数据库操作集合
 * 提供对工作区表的 CRUD 操作
 */
export const dbWorkspaces = {
  /**
   * 获取所有工作区
   * @returns 返回工作区数组
   */
  getAll: (): Workspace[] => {
    const stmt = getDb().prepare('SELECT * FROM workspaces ORDER BY is_default DESC, created_at DESC');
    return stmt.all() as Workspace[];
  },

  /**
   * 获取默认工作区
   * @returns 返回默认工作区，如果不存在则返回 undefined
   */
  getDefault: (): Workspace | undefined => {
    const stmt = getDb().prepare('SELECT * FROM workspaces WHERE is_default = 1 LIMIT 1');
    return stmt.get() as Workspace | undefined;
  },

  /**
   * 根据 ID 获取工作区
   * @param id - 工作区 ID
   * @returns 返回工作区对象
   */
  getById: (id: string): Workspace | undefined => {
    const stmt = getDb().prepare('SELECT * FROM workspaces WHERE id = ?');
    return stmt.get(id) as Workspace | undefined;
  },

  /**
   * 添加新工作区
   * @param workspace - 工作区对象
   * @returns 返回新工作区 ID
   */
  add: (workspace: Omit<Workspace, 'id'>): string => {
    const newId = uuidv4();
    const stmt = getDb().prepare(`
      INSERT INTO workspaces (id, name, path, is_default, created_at)
      VALUES (?, ?, ?, ?, ?)
    `);
    stmt.run(newId, workspace.name, workspace.path, workspace.is_default, workspace.created_at);
    return newId;
  },

  /**
   * 设置默认工作区
   * @param id - 工作区 ID
   */
  setDefault: (id: string): void => {
    const db = getDb();
    const transaction = db.transaction(() => {
      db.prepare('UPDATE workspaces SET is_default = 0').run();
      db.prepare('UPDATE workspaces SET is_default = 1 WHERE id = ?').run(id);
    });
    transaction();
  }
};

// 导出数据库实例获取函数,用于需要直接操作数据库的场景
export default getDb;

// ==================== 对话操作 (v3 新增) ====================

/**
 * 对话数据库操作集合
 * 提供对对话表的 CRUD 操作
 */
export const dbConversations = {
  /**
   * 获取指定书籍的所有对话
   * @param bookId - 书籍ID (UUID)
   * @returns 返回按创建时间倒序排列的对话数组
   */
  getByBookId: (bookId: string): Conversation[] => {
    const stmt = getDb().prepare('SELECT * FROM conversations WHERE book_id = ? ORDER BY updated_at DESC');
    return stmt.all(bookId) as Conversation[];
  },

  /**
   * 根据ID获取单个对话
   * @param id - 对话ID (UUID)
   * @returns 返回对话对象,如果不存在则返回 undefined
   */
  getById: (id: string): Conversation | undefined => {
    const stmt = getDb().prepare('SELECT * FROM conversations WHERE id = ?');
    return stmt.get(id) as Conversation | undefined;
  },

  /**
   * 创建新对话
   * @param bookId - 书籍ID (UUID)
   * @param title - 对话标题
   * @param model - 使用的模型
   * @returns 返回新插入记录的 ID (UUID)
   */
  create: (bookId: string, title: string, model: string = 'claude-sonnet-4-5-20250929'): string => {
    const newId = uuidv4();
    const now = Date.now();

    const stmt = getDb().prepare(`
      INSERT INTO conversations (id, book_id, title, model, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    stmt.run(newId, bookId, title, model, now, now);
    return newId;
  },

  /**
   * 更新对话标题
   * @param id - 对话ID (UUID)
   * @param title - 新标题
   */
  updateTitle: (id: string, title: string): void => {
    const stmt = getDb().prepare('UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?');
    stmt.run(title, Date.now(), id);
  },

  /**
   * 更新 SDK session_id（用于 resume 功能）
   * @param id - 对话ID (UUID)
   * @param sdkSessionId - SDK 返回的 session_id
   */
  updateSdkSessionId: (id: string, sdkSessionId: string): void => {
    const stmt = getDb().prepare('UPDATE conversations SET sdk_session_id = ?, updated_at = ? WHERE id = ?');
    stmt.run(sdkSessionId, Date.now(), id);
  },

  /**
   * 更新对话的最后更新时间
   * @param id - 对话ID (UUID)
   */
  touch: (id: string): void => {
    const stmt = getDb().prepare('UPDATE conversations SET updated_at = ? WHERE id = ?');
    stmt.run(Date.now(), id);
  },

  /**
   * 删除对话（级联删除相关消息）
   * @param id - 对话ID (UUID)
   */
  delete: (id: string): void => {
    const stmt = getDb().prepare('DELETE FROM conversations WHERE id = ?');
    stmt.run(id);
  },

  /**
   * 创建分叉对话（v4 新增）
   * @param bookId - 书籍ID
   * @param title - 对话标题（含来源标注）
   * @param parentConversationId - 父对话ID
   * @param forkMessageSdkUuid - 分叉点的 assistant 消息 SDK UUID
   * @param model - 模型名称
   * @returns 新对话 ID
   */
  createFork: (
    bookId: string,
    title: string,
    parentConversationId: string,
    forkMessageSdkUuid: string,
    model: string = 'claude-sonnet-4-5-20250929'
  ): string => {
    const newId = uuidv4();
    const now = Date.now();
    const stmt = getDb().prepare(`
      INSERT INTO conversations (id, book_id, title, model, parent_conversation_id, fork_message_sdk_uuid, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(newId, bookId, title, model, parentConversationId, forkMessageSdkUuid, now, now);
    return newId;
  }
};

// ==================== 对话消息操作 (v3 新增) ====================

/**
 * 对话消息数据库操作集合
 * 提供对对话消息表的 CRUD 操作
 */
export const dbConversationMessages = {
  /**
   * 获取指定对话的所有消息
   * @param conversationId - 对话ID (UUID)
   * @returns 返回按时间戳升序排列的消息数组
   */
  getByConversationId: (conversationId: string): ConversationMessage[] => {
    const stmt = getDb().prepare('SELECT * FROM conversation_messages WHERE conversation_id = ? ORDER BY timestamp ASC');
    return stmt.all(conversationId) as ConversationMessage[];
  },

  /**
   * 添加新消息
   * @param message - 消息对象
   * @returns 返回新插入记录的 ID (UUID)
   */
  add: (message: Omit<ConversationMessage, 'id'>): string => {
    const newId = uuidv4();

    const stmt = getDb().prepare(`
      INSERT INTO conversation_messages (id, conversation_id, role, content, content_blocks, sdk_uuid, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      newId,
      message.conversation_id,
      message.role,
      message.content,
      message.content_blocks || null,
      message.sdk_uuid || null,
      message.timestamp
    );

    // 更新对话的最后更新时间
    dbConversations.touch(message.conversation_id);

    return newId;
  },

  /**
   * 批量添加消息（用于恢复对话）
   * @param messages - 消息数组
   */
  bulkAdd: (messages: Omit<ConversationMessage, 'id'>[]): void => {
    const insert = getDb().prepare(`
      INSERT INTO conversation_messages (id, conversation_id, role, content, content_blocks, sdk_uuid, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    const transaction = getDb().transaction((msgs: Omit<ConversationMessage, 'id'>[]) => {
      for (const message of msgs) {
        const newId = uuidv4();
        insert.run(
          newId,
          message.conversation_id,
          message.role,
          message.content,
          message.content_blocks || null,
          message.sdk_uuid || null,
          message.timestamp
        );
      }
      // 更新对话的最后更新时间
      if (msgs.length > 0) {
        dbConversations.touch(msgs[0].conversation_id);
      }
    });

    transaction(messages);
  },

  /**
   * 删除对话的所有消息
   * @param conversationId - 对话ID (UUID)
   */
  deleteByConversationId: (conversationId: string): void => {
    const stmt = getDb().prepare('DELETE FROM conversation_messages WHERE conversation_id = ?');
    stmt.run(conversationId);
  }
};

// ==================== 对话分支操作 (v4 新增) ====================

/**
 * 对话分支数据库操作集合
 * 用于编辑重发时的分支版本管理
 */
export const dbConversationBranches = {
  /**
   * 创建分支记录
   */
  create: (
    conversationId: string,
    forkPointSdkUuid: string,
    branchIndex: number,
    sdkSessionId: string
  ): string => {
    const newId = uuidv4();
    const now = Date.now();
    const stmt = getDb().prepare(`
      INSERT INTO conversation_branches (id, conversation_id, fork_point_sdk_uuid, branch_index, sdk_session_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    stmt.run(newId, conversationId, forkPointSdkUuid, branchIndex, sdkSessionId, now);
    return newId;
  },

  /**
   * 获取指定对话在指定分叉点的所有分支
   */
  getByConversationAndForkPoint: (conversationId: string, forkPointSdkUuid: string): ConversationBranch[] => {
    const stmt = getDb().prepare(
      'SELECT * FROM conversation_branches WHERE conversation_id = ? AND fork_point_sdk_uuid = ? ORDER BY branch_index ASC'
    );
    return stmt.all(conversationId, forkPointSdkUuid) as ConversationBranch[];
  },

  /**
   * 获取指定对话的所有分支
   */
  getByConversationId: (conversationId: string): ConversationBranch[] => {
    const stmt = getDb().prepare(
      'SELECT * FROM conversation_branches WHERE conversation_id = ? ORDER BY fork_point_sdk_uuid, branch_index ASC'
    );
    return stmt.all(conversationId) as ConversationBranch[];
  },

  /**
   * 获取指定分叉点的下一个分支序号
   */
  getNextBranchIndex: (conversationId: string, forkPointSdkUuid: string): number => {
    const stmt = getDb().prepare(
      'SELECT MAX(branch_index) as max_index FROM conversation_branches WHERE conversation_id = ? AND fork_point_sdk_uuid = ?'
    );
    const result = stmt.get(conversationId, forkPointSdkUuid) as { max_index: number | null } | undefined;
    return (result?.max_index ?? -1) + 1;
  },

  /**
   * 将最新的 pending- session ID 更新为真实的 SDK session ID
   * 编辑重发时，先创建 pending- 占位，SDK 初始化后回填真实值
   */
  updatePendingSdkSessionId: (conversationId: string, realSdkSessionId: string): void => {
    // 找到该对话下最新的 pending- 记录并更新
    const stmt = getDb().prepare(`
      UPDATE conversation_branches
      SET sdk_session_id = ?
      WHERE id = (
        SELECT id FROM conversation_branches
        WHERE conversation_id = ? AND sdk_session_id LIKE 'pending-%'
        ORDER BY created_at DESC
        LIMIT 1
      )
    `);
    stmt.run(realSdkSessionId, conversationId);
  }
};

// ==================== 分支消息操作 (v4 新增) ====================

/**
 * 分支消息数据库操作集合
 */
export const dbBranchMessages = {
  /**
   * 添加分支消息
   */
  add: (message: Omit<BranchMessage, 'id'>): string => {
    const newId = uuidv4();
    const stmt = getDb().prepare(`
      INSERT INTO branch_messages (id, branch_id, conversation_id, role, content, content_blocks, sdk_uuid, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      newId,
      message.branch_id,
      message.conversation_id,
      message.role,
      message.content,
      message.content_blocks || null,
      message.sdk_uuid || null,
      message.timestamp
    );
    return newId;
  },

  /**
   * 批量添加分支消息
   */
  bulkAdd: (messages: Omit<BranchMessage, 'id'>[]): void => {
    const insert = getDb().prepare(`
      INSERT INTO branch_messages (id, branch_id, conversation_id, role, content, content_blocks, sdk_uuid, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const transaction = getDb().transaction((msgs: Omit<BranchMessage, 'id'>[]) => {
      for (const msg of msgs) {
        insert.run(uuidv4(), msg.branch_id, msg.conversation_id, msg.role, msg.content, msg.content_blocks || null, msg.sdk_uuid || null, msg.timestamp);
      }
    });
    transaction(messages);
  },

  /**
   * 获取指定分支的所有消息
   */
  getByBranchId: (branchId: string): BranchMessage[] => {
    const stmt = getDb().prepare('SELECT * FROM branch_messages WHERE branch_id = ? ORDER BY timestamp ASC');
    return stmt.all(branchId) as BranchMessage[];
  }
};
