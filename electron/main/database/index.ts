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

// ==================== 数据库初始化 ====================

// 数据库实例(延迟初始化)
let db: BetterSqlite3.Database | null = null;

/**
 * 初始化数据库
 * @param dbPath - 数据库文件路径(可选,默认使用 app.getPath('userData'))
 */
export async function initDatabase(dbPath?: string): Promise<BetterSqlite3.Database> {
  if (db) {
    return db;
  }

  // 如果没有提供路径,使用 electron app 的用户数据目录
  if (!dbPath) {
    const { app } = await import('electron');
    const userDataPath = app.getPath('userData');
    dbPath = path.join(userDataPath, 'dogear.db');
  }

  // 读取数据库 schema 定义文件
  const schemaPath = path.join(__dirname, 'schema.sql');
  const schema = fs.readFileSync(schemaPath, 'utf-8');

  // 创建数据库连接
  db = new Database(dbPath);

  // 执行 schema,创建表和索引
  db.exec(schema);

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
        cover_image, metadata
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
  }
};

// 导出数据库实例获取函数,用于需要直接操作数据库的场景
export default getDb;
