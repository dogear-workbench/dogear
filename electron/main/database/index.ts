import Database from 'better-sqlite3';
import { app } from 'electron';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

// 获取当前文件的路径和目录名(ES Module 环境)
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * 书籍数据接口
 * 定义书籍对象的数据结构
 */
export interface Book {
  id?: number;                // 书籍唯一标识
  title: string;              // 书名
  author?: string;            // 作者
  file_path: string;          // 文件路径
  file_type: string;          // 文件类型(epub/txt/pdf)
  total_pages?: number;       // 总页数
  current_page?: number;      // 当前阅读页码
  cover_image?: string;       // 封面图片路径
  metadata?: string;          // 其他元数据(JSON 格式)
  created_at?: string;        // 创建时间
  updated_at?: string;        // 更新时间
}

/**
 * AI 交互记录接口
 * 定义 AI 交互记录的数据结构
 */
export interface AIInteraction {
  id?: number;                // 交互记录唯一标识
  book_id?: number;           // 关联的书籍 ID
  type: 'chat' | 'summarize' | 'qna';  // 交互类型
  user_message?: string;      // 用户的消息
  ai_response: string;        // AI 的回复
  context_text?: string;      // 上下文文本
  model_info?: string;        // 模型信息
  created_at?: string;        // 交互时间
}

// ==================== 数据库初始化 ====================

// 读取数据库 schema 定义文件
const schemaPath = path.join(__dirname, 'schema.sql');
const schema = fs.readFileSync(schemaPath, 'utf-8');

// 获取用户数据目录(应用数据存储位置)
const userDataPath = app.getPath('userData');
const dbPath = path.join(userDataPath, 'dogear.db');

// 创建数据库连接
const db = new Database(dbPath);

// 执行 schema,创建表和索引
db.exec(schema);

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
    const stmt = db.prepare('SELECT * FROM books ORDER BY created_at DESC');
    return stmt.all() as Book[];
  },

  /**
   * 根据 ID 获取单本书籍
   * @param id - 书籍 ID
   * @returns 返回书籍对象,如果不存在则返回 undefined
   */
  getById: (id: number): Book | undefined => {
    const stmt = db.prepare('SELECT * FROM books WHERE id = ?');
    return stmt.get(id) as Book | undefined;
  },

  /**
   * 添加新书籍
   * @param book - 书籍对象
   * @returns 返回新插入记录的 ID
   */
  add: (book: Book): number => {
    const stmt = db.prepare(`
      INSERT INTO books (title, author, file_path, file_type, total_pages, current_page, cover_image, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const result = stmt.run(
      book.title,
      book.author || null,
      book.file_path,
      book.file_type,
      book.total_pages || null,
      book.current_page || 0,
      book.cover_image || null,
      book.metadata || null
    );
    return result.lastInsertRowid as number;
  },

  /**
   * 更新书籍信息
   * @param id - 书籍 ID
   * @param book - 包含更新字段的对象
   */
  update: (id: number, book: Partial<Book>): void => {
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
    const stmt = db.prepare(`UPDATE books SET ${fields}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`);
    stmt.run(...values, id);
  },

  /**
   * 删除书籍
   * 由于外键级联约束,相关联的 AI 交互记录也会被删除
   * @param id - 书籍 ID
   */
  delete: (id: number): void => {
    const stmt = db.prepare('DELETE FROM books WHERE id = ?');
    stmt.run(id);
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
   * @param bookId - 书籍 ID
   * @returns 返回按创建时间倒序排列的交互记录数组
   */
  getByBookId: (bookId: number): AIInteraction[] => {
    const stmt = db.prepare('SELECT * FROM ai_interactions WHERE book_id = ? ORDER BY created_at DESC');
    return stmt.all(bookId) as AIInteraction[];
  },

  /**
   * 添加新的 AI 交互记录
   * @param interaction - AI 交互对象
   * @returns 返回新插入记录的 ID
   */
  add: (interaction: AIInteraction): number => {
    const stmt = db.prepare(`
      INSERT INTO ai_interactions (book_id, type, user_message, ai_response, context_text, model_info)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const result = stmt.run(
      interaction.book_id || null,
      interaction.type,
      interaction.user_message || null,
      interaction.ai_response,
      interaction.context_text || null,
      interaction.model_info || null
    );
    return result.lastInsertRowid as number;
  }
};

// 导出数据库实例,用于需要直接操作数据库的场景
export default db;
