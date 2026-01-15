import { Book, Chapter, ChapterMetadata, AIInteraction } from './types';

/**
 * Electron 数据库操作封装
 * 提供与 Electron 主进程数据库通信的接口
 * 包含环境检查,确保只在 Electron 环境中运行
 */
export const electronDB = {
  /**
   * 获取所有书籍列表
   * @returns 返回书籍数组,在非 Electron 环境返回空数组
   */
  getBooks: async (): Promise<Book[]> => {
    if (typeof window !== 'undefined' && window.electronAPI) {
      return window.electronAPI.db.getBooks();
    }
    return [];
  },

  /**
   * 根据 ID 获取单本书籍
   * @param id - 书籍 ID (UUID)
   * @returns 返回书籍对象
   * @throws 在非 Electron 环境抛出错误
   */
  getBookById: async (id: string): Promise<Book> => {
    if (typeof window !== 'undefined' && window.electronAPI) {
      return window.electronAPI.db.getBookById(id);
    }
    throw new Error('Electron API not available');
  },

  /**
   * 添加新书籍
   * @param book - 书籍对象
   * @returns 返回新创建书籍的 ID (UUID)
   * @throws 在非 Electron 环境抛出错误
   */
  addBook: async (book: Book): Promise<string> => {
    if (typeof window !== 'undefined' && window.electronAPI) {
      return window.electronAPI.db.addBook(book);
    }
    throw new Error('Electron API not available');
  },

  /**
   * 更新书籍信息
   * @param id - 书籍 ID (UUID)
   * @param data - 包含更新字段的对象
   * @throws 在非 Electron 环境抛出错误
   */
  updateBook: async (id: string, data: Partial<Book>): Promise<void> => {
    if (typeof window !== 'undefined' && window.electronAPI) {
      return window.electronAPI.db.updateBook(id, data);
    }
    throw new Error('Electron API not available');
  },

  /**
   * 删除书籍
   * @param id - 书籍 ID (UUID)
   * @throws 在非 Electron 环境抛出错误
   */
  deleteBook: async (id: string): Promise<void> => {
    if (typeof window !== 'undefined' && window.electronAPI) {
      return window.electronAPI.db.deleteBook(id);
    }
    throw new Error('Electron API not available');
  },
};

/**
 * Electron AI 服务封装
 * 提供 AI 对话和文本摘要功能的接口
 */
export const electronAI = {
  /**
   * AI 对话
   * @param messages - 对话消息数组
   * @returns 返回 AI 的回复
   * @throws 在非 Electron 环境抛出错误
   */
  chat: async (messages: any[]): Promise<string> => {
    if (typeof window !== 'undefined' && window.electronAPI) {
      return window.electronAPI.ai.chat(messages);
    }
    throw new Error('Electron API not available');
  },

  /**
   * 生成文本摘要
   * @param text - 需要摘要的文本
   * @returns 返回文本摘要
   * @throws 在非 Electron 环境抛出错误
   */
  summarize: async (text: string): Promise<string> => {
    if (typeof window !== 'undefined' && window.electronAPI) {
      return window.electronAPI.ai.summarize(text);
    }
    throw new Error('Electron API not available');
  },
};

/**
 * Electron 文件操作封装
 * 提供文件选择和书籍导入功能的接口
 */
export const electronFile = {
  /**
   * 打开文件选择对话框
   * @returns 返回选中的文件路径,取消则返回 null
   */
  selectFile: async (): Promise<string | null> => {
    if (typeof window !== 'undefined' && window.electronAPI) {
      return window.electronAPI.file.selectFile();
    }
    return null;
  },

  /**
   * 导入书籍文件
   * @param path - 文件路径
   * @returns 返回导入的书籍信息
   * @throws 在非 Electron 环境抛出错误
   */
  importBook: async (path: string): Promise<Book> => {
    if (typeof window !== 'undefined' && window.electronAPI) {
      return window.electronAPI.file.importBook(path);
    }
    throw new Error('Electron API not available');
  },
};

/**
 * Electron 书籍内容读取封装
 * 提供读取书籍内容的接口
 */
export const electronBook = {
  /**
   * 获取书籍的章节元数据列表(不含 content,用于目录导航)
   * @param bookId - 书籍ID (UUID)
   * @returns 返回章节元数据数组
   */
  getChapterMetadata: async (bookId: string): Promise<ChapterMetadata[]> => {
    if (typeof window !== 'undefined' && window.electronAPI) {
      return window.electronAPI.book.getChapterMetadata(bookId);
    }
    throw new Error('Electron API not available');
  },

  /**
   * 获取指定章节的完整内容(包含 content)
   * @param chapterId - 章节ID (UUID)
   * @returns 返回完整章节对象
   */
  getChapter: async (chapterId: string): Promise<Chapter> => {
    if (typeof window !== 'undefined' && window.electronAPI) {
      return window.electronAPI.book.getChapter(chapterId);
    }
    throw new Error('Electron API not available');
  },

  /**
   * 保存阅读进度
   * @param bookId - 书籍ID (UUID)
   * @param chapterId - 当前章节ID (UUID)
   */
  saveProgress: async (bookId: string, chapterId: string): Promise<void> => {
    if (typeof window !== 'undefined' && window.electronAPI) {
      return window.electronAPI.book.saveProgress(bookId, chapterId);
    }
    throw new Error('Electron API not available');
  },
};
